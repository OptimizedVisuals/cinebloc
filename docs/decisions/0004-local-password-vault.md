# ADR 0004: Local password vault (AES-GCM at rest)

**Status:** accepted · 2026-10-04

## Context

Before launch, everything sensitive sat in IndexedDB as plaintext: the BYOK
API key, scripts, shot data, and images. On a shared editing machine, a set
phone handed between crew, or a stolen laptop, anyone with browser-profile
access could read it. The product promise — "your files never leave this
device" — should also mean nobody else on this device can read them.

## Decision

An **encrypting decorator over `StoragePort`** (`adapters/vault/`) controlled
by a `VaultPort` (kernel):

- **Full vault scope:** API key (settings meta), projects, shot lists, and
  image blobs are all encrypted at rest.
- **Crypto:** WebCrypto only, zero dependencies — PBKDF2-HMAC-SHA256
  (310,000 iterations, OWASP) derives a non-extractable AES-GCM-256 key from
  the password. Random 12-byte IV per encryption. `vault_salt` and a
  verifier envelope are the only plaintext meta (they leak nothing without
  the password).
- **Modes:** `off` (no password, plaintext passthrough) → `locked` (every
  data operation throws) → `unlocked` (key in memory only, encrypt-on-write /
  decrypt-on-read).
- **Lifecycle:** `setup()` migrates all existing plaintext in place
  (collect → derive → rewrite). Re-locks on open and via a header Lock
  button; locking first flushes pending writes, then drops the key and resets
  the store so no plaintext stays resident. Persistence is hard-gated while
  locked so a stale write can never clobber encrypted data.
- **Forgotten password:** destructive reset only — `eraseLocalData()` closes
  and deletes the entire local database from the lock screen, behind an
  explicit two-step confirm. No backdoor: a bypass would make the encryption
  decorative.
- **Composition:** `main.tsx` awaits `createVaultedStorage()` and boots into
  the lock screen when a salt exists; hydrate runs only after unlock.

## Why a decorator

The alternative — teaching every feature to encrypt — would have leaked
crypto concerns into state, features, and export. Wrapping the port means
**not one feature changed**: canvas, checklist, parser, persistence, and
export all kept working unmodified, which is exactly what the dependency law
promised. `src/__tests__/architecture.test.ts` still passes untouched.

## Alternatives rejected

- **Password-protect only the API key:** the script text and reference
  images are the actual IP; partial protection is a false sense of safety.
- **Encrypt on export only:** protects backups, not the machine itself.
- **WebAuthn/biometrics:** better UX but platform-dependent and loses the
  cross-device portability of a password; can be layered later.
- **Changing password in place:** requires re-encrypting every blob under a
  new key (key rotation) — deferred; v1 documents erase + re-setup instead.

## Known tradeoffs

- Lost password ⇒ lost data (by design; stated in UI before enabling).
- Encryption protects data at rest, not a browser extension or XSS running
  in an *unlocked* session — the threat model is shared/theft-of-device, not
  code execution on your machine.
- Key derivation adds ~0.3–1s per unlock (310k PBKDF2 rounds) — accepted as
  the cost of memory-hard-ish KDF without native argon2.
