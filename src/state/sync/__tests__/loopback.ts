import type { SyncTransportPort, SyncTransportState } from '@/kernel'

/**
 * A pair of connected in-memory transports — the test equivalent of a real
 * data channel, with the failure modes a real one has.
 *
 * Why not a single mock transport: the engine's correctness lives in what the
 * *other* side does with what arrives (cursor advancement, ACK timing, resume
 * after a drop). Every engine test therefore runs two independent peers, each
 * with its own journal, storage, identity and transport.
 *
 * Delivery is asynchronous and in order, like an SCTP channel, so the engine's
 * serial queue is exercised rather than bypassed by synchronous calls.
 */

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Extra traffic to deliver *inside* the same delivery turn as a match. */
interface FollowUp {
  match: (raw: string) => boolean
  /** null = re-deliver the matching frame itself (a duplicate). */
  raw: string | null
}

class LinkCore {
  open = true
  frozen = false
  breakMatch: ((raw: string) => boolean) | null = null
  deliverHook: ((raw: string) => void) | null = null
  corruptBinary = 0
  readonly followUps: FollowUp[] = []
  readonly sentA: string[] = []
  readonly sentB: string[] = []
  private readonly queue: (() => void)[] = []
  private scheduled = false
  private ends: { a: LoopbackTransport; b: LoopbackTransport } | null = null

  attach(a: LoopbackTransport, b: LoopbackTransport): void {
    this.ends = { a, b }
  }

  record(from: 'a' | 'b', raw: string): void {
    ;(from === 'a' ? this.sentA : this.sentB).push(raw)
  }

  enqueue(task: () => void): void {
    this.queue.push(task)
    if (this.scheduled) return
    this.scheduled = true
    setTimeout(() => {
      this.scheduled = false
      const tasks = this.queue.splice(0, this.queue.length)
      for (const next of tasks) next()
    }, 0)
  }

  send(from: 'a' | 'b', raw: string): void {
    const target = from === 'a' ? this.ends?.b : this.ends?.a
    if (!target) return
    this.enqueue(() => this.deliver(target, raw))
  }

  /**
   * Deliver one frame, then any follow-up traffic for it. Follow-ups are
   * synchronous on purpose: a duplicate or an injected frame then lands before
   * the session can finish and unsubscribe, which is what makes those tests
   * exercise the real path instead of a closed transport.
   */
  deliver(target: LoopbackTransport, raw: string): void {
    if (!this.open || this.frozen) return
    this.deliverHook?.(raw)
    target.receiveFrame(raw)
    for (let i = this.followUps.length - 1; i >= 0; i--) {
      const followUp = this.followUps[i]
      if (!followUp.match(raw)) continue
      this.followUps.splice(i, 1)
      target.receiveFrame(followUp.raw ?? raw)
    }
    if (this.breakMatch?.(raw)) this.break()
  }

  sendBinary(from: 'a' | 'b', bytes: Uint8Array): void {
    const target = from === 'a' ? this.ends?.b : this.ends?.a
    if (!target) return
    this.enqueue(() => {
      if (!this.open || this.frozen) return
      target.receiveBinary(bytes)
    })
  }

  break(): void {
    if (!this.open) return
    this.open = false
    this.ends?.a.markDisconnected()
    this.ends?.b.markDisconnected()
  }

  /**
   * One end went away, as a real peer connection does when it closes: whatever
   * was already on the wire still arrives, then the far end is told.
   */
  peerClosed(from: 'a' | 'b'): void {
    const other = from === 'a' ? this.ends?.b : this.ends?.a
    this.enqueue(() => other?.markDisconnected())
  }

  pendingFrames(): number {
    return this.queue.length
  }
}

function corrupt(bytes: Uint8Array): Uint8Array {
  const copy = bytes.slice()
  // Flip the last byte: same length, different content, so only a hash check
  // can tell the difference.
  const index = copy.length - 1
  copy[index] = (copy[index] ^ 0xff) & 0xff
  return copy
}

export class LoopbackTransport implements SyncTransportPort {
  private current: SyncTransportState = 'connected'
  private closed = false
  private readonly stateListeners = new Set<(state: SyncTransportState) => void>()
  private readonly frameListeners = new Set<(raw: string) => void>()
  private readonly binaryListeners = new Set<(chunk: ArrayBuffer) => void>()
  private readonly errorListeners = new Set<(error: Error) => void>()

  constructor(
    private readonly core: LinkCore,
    private readonly side: 'a' | 'b',
  ) {}

  state(): SyncTransportState {
    return this.current
  }

  onStateChange(listener: (state: SyncTransportState) => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  onFrame(listener: (raw: string) => void): () => void {
    this.frameListeners.add(listener)
    return () => this.frameListeners.delete(listener)
  }

  onBinary(listener: (chunk: ArrayBuffer) => void): () => void {
    this.binaryListeners.add(listener)
    return () => this.binaryListeners.delete(listener)
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  sendText(text: string): void {
    if (this.closed) return
    this.core.record(this.side, text)
    this.core.send(this.side, text)
  }

  sendBinary(chunk: Uint8Array): void {
    if (this.closed) return
    const payload = this.core.corruptBinary > 0 ? corrupt(chunk) : chunk.slice()
    if (this.core.corruptBinary > 0) this.core.corruptBinary -= 1
    this.core.sendBinary(this.side, payload)
  }

  bufferedAmount(): number {
    return 0
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.core.peerClosed(this.side)
  }

  // ── test hooks ─────────────────────────────────────────────────────────────

  /** Deliver a frame to this side as though the other device had sent it. */
  receiveFrame(raw: string): void {
    for (const listener of this.frameListeners) listener(raw)
  }

  receiveBinary(bytes: Uint8Array): void {
    for (const listener of this.binaryListeners) listener(bytes.buffer as ArrayBuffer)
  }

  markDisconnected(): void {
    if (this.current === 'disconnected') return
    this.current = 'disconnected'
    for (const listener of this.stateListeners) listener('disconnected')
  }

  fail(error: Error): void {
    this.current = 'failed'
    for (const listener of this.errorListeners) listener(error)
    for (const listener of this.stateListeners) listener('failed')
  }
}

export interface LoopbackLink {
  /** Cut the link: both ends report a lost connection. */
  break(): void
  /** Stop delivering frames without any state change. */
  freeze(): void
  /** Resume delivering frames. */
  thaw(): void
  /** Cut the link as soon as a delivered frame matches. */
  breakAfter(match: (raw: string) => boolean): void
  /** Observe every frame as it is handed to a peer. */
  onDeliver(hook: (raw: string) => void): void
  /** Hand `raw` to one side as though the other had sent it. */
  inject(side: 'a' | 'b', raw: string): void
  /** Re-deliver the matching frame a second time, immediately (duplicate). */
  duplicateNext(match: (raw: string) => boolean): void
  /** Deliver `raw` again right after the matching frame, same delivery turn. */
  injectOnNextDelivery(match: (raw: string) => boolean, raw: string): void
  /** Corrupt the next `count` binary frames in transit. */
  corruptBinaryFrames(count: number): void
  /** Frames each side sent, in order (for assertions on protocol traffic). */
  sent(): { a: string[]; b: string[] }
  /** Wait until nothing is queued and no handler is producing more traffic. */
  settle(): Promise<void>
}

export function createLoopback(): {
  a: LoopbackTransport
  b: LoopbackTransport
  link: LoopbackLink
} {
  const core = new LinkCore()
  const a = new LoopbackTransport(core, 'a')
  const b = new LoopbackTransport(core, 'b')
  core.attach(a, b)

  const link: LoopbackLink = {
    break: () => core.break(),
    freeze: () => {
      core.frozen = true
    },
    thaw: () => {
      core.frozen = false
    },
    breakAfter: (match) => {
      core.breakMatch = match
    },
    onDeliver: (hook) => {
      core.deliverHook = hook
    },
    inject: (side, raw) => {
      const target = side === 'a' ? a : b
      core.enqueue(() => core.deliver(target, raw))
    },
    duplicateNext: (match) => {
      core.followUps.push({ match, raw: null })
    },
    injectOnNextDelivery: (match, raw) => {
      core.followUps.push({ match, raw })
    },
    corruptBinaryFrames: (count) => {
      core.corruptBinary = count
    },
    sent: () => ({ a: [...core.sentA], b: [...core.sentB] }),
    settle: async () => {
      let idle = 0
      for (let round = 0; round < 500 && idle < 3; round++) {
        idle = core.pendingFrames() === 0 ? idle + 1 : 0
        await delay(1)
      }
    },
  }

  return { a, b, link }
}
