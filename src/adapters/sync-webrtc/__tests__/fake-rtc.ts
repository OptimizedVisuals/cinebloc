/**
 * Minimal stand-ins for `RTCPeerConnection` / `RTCDataChannel`.
 *
 * Node has no WebRTC stack, so the adapter's own logic (offer/answer, waiting
 * for ICE gathering, framing strings vs binary, channel state) is exercised
 * against these. The real browser connection is verified separately in a
 * browser; this file proves the adapter's decisions, not the network.
 */

type Listener = (event: unknown) => void

export class FakeChannel {
  readyState: 'connecting' | 'open' | 'closing' | 'closed' = 'connecting'
  binaryType = 'blob'
  bufferedAmount = 0
  sent: (string | ArrayBuffer)[] = []
  peer: FakeChannel | null = null
  private readonly listeners = new Map<string, Set<Listener>>()

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  emit(type: string, event?: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event)
  }

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    // A real channel delivers bytes as an ArrayBuffer (binaryType), never as
    // the view that was handed to `send`.
    const normalized = ArrayBuffer.isView(data)
      ? (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength)
      : (data as string | ArrayBuffer)
    this.sent.push(normalized)
    this.peer?.receive(normalized)
  }

  receive(data: string | ArrayBuffer): void {
    this.emit('message', { data })
  }

  open(): void {
    this.readyState = 'open'
    this.emit('open')
  }

  close(): void {
    if (this.readyState === 'closed') return
    this.readyState = 'closed'
    this.emit('close')
  }

  fail(): void {
    this.emit('error')
  }
}

export class FakePeer {
  iceGatheringState: 'new' | 'gathering' | 'complete' = 'complete'
  connectionState: 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed' = 'new'
  localDescription: { type: string; sdp: string } | null = null
  remoteDescription: { type: string; sdp: string } | null = null
  readonly channels: FakeChannel[] = []
  private readonly listeners = new Map<string, Set<Listener>>()

  constructor(gathering: 'immediate' | 'manual' = 'immediate') {
    this.iceGatheringState = gathering === 'manual' ? 'gathering' : 'complete'
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  emit(type: string, event?: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event)
  }

  createDataChannel(): FakeChannel {
    const channel = new FakeChannel()
    this.channels.push(channel)
    return channel
  }

  async createOffer(): Promise<{ type: string; sdp: string }> {
    return { type: 'offer', sdp: 'v=0\r\no=fake-offer' }
  }

  async createAnswer(): Promise<{ type: string; sdp: string }> {
    return { type: 'answer', sdp: 'v=0\r\no=fake-answer' }
  }

  async setLocalDescription(description: { type: string; sdp?: string }): Promise<void> {
    this.localDescription = { type: description.type, sdp: description.sdp ?? '' }
  }

  async setRemoteDescription(description: { type: string; sdp: string }): Promise<void> {
    this.remoteDescription = description
  }

  finishGathering(): void {
    this.iceGatheringState = 'complete'
    this.emit('icegatheringstatechange')
  }

  connect(): void {
    this.connectionState = 'connected'
    this.emit('connectionstatechange')
  }

  close(): void {
    this.connectionState = 'closed'
    this.emit('connectionstatechange')
  }
}

export function asPeer(peer: FakePeer): RTCPeerConnection {
  return peer as unknown as RTCPeerConnection
}
