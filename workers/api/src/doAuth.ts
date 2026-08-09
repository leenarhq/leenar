// Short-lived HMAC-SHA256 tokens for Worker → Durable Object auth (and, with a
// longer TTL, MCP tool confirm-gates — see MCP_CONFIRM_TOKEN_TTL_S).
// Format: "<unix_ts_seconds>.<base64url(sig)>"
// Token valid for `ttlS` seconds (default 60); action-bound to prevent
// cross-action replay. Replay of the same nonce is rejected within the TTL
// window. When a durable store is supplied (from inside the DO) the nonce is
// persisted so replay protection survives isolate eviction; otherwise it
// falls back to an isolate-local in-memory map (best-effort).

const TOKEN_TTL_S = 60

// MCP confirm-gate tokens need to survive a real round-trip between an LLM
// client and a human (or the LLM re-reading the confirmation prompt), which
// can take longer than the 60s used for Worker→DO auth.
export const MCP_CONFIRM_TOKEN_TTL_S = 300
const DURABLE_NONCE_PREFIX = 'dononce:'
const usedNonces = new Map<string, number>() // nonce → expiry unix seconds

function pruneNonces(now: number) {
  for (const [n, exp] of usedNonces) {
    if (exp < now) usedNonces.delete(n)
  }
}

// Minimal subset of DurableObjectStorage used for durable replay tracking.
export interface NonceStorage {
  get(key: string): Promise<unknown>
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<boolean>
  list(options: { prefix: string }): Promise<Map<string, unknown>>
}

// Lazily drop expired durable nonce keys so storage stays bounded. Provision
// starts/cancels are infrequent heavy operations, so an extra list per verify
// is cheap relative to the work they trigger.
async function pruneDurableNonces(storage: NonceStorage, now: number) {
  const all = await storage.list({ prefix: DURABLE_NONCE_PREFIX })
  const expired: string[] = []
  for (const [k, exp] of all) {
    if (typeof exp === 'number' && exp < now) expired.push(k)
  }
  await Promise.all(expired.map((k) => storage.delete(k)))
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function signDoToken(secret: string, action: string): Promise<string> {
  const ts    = Math.floor(Date.now() / 1000)
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)).buffer)
  const msg   = `${ts}.${action}.${nonce}`
  const key   = await getHmacKey(secret)
  const sig   = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))
  return `${ts}.${nonce}.${b64url(sig)}`
}

export async function verifyDoToken(
  token: string,
  secret: string,
  action: string,
  storage?: NonceStorage,
  ttlS: number = TOKEN_TTL_S,
): Promise<boolean> {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [tsStr, nonce, sig] = parts
  const ts = parseInt(tsStr, 10)
  if (isNaN(ts)) return false

  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > ttlS) return false

  const nonceKey = `${action}:${nonce}`
  if (storage) {
    await pruneDurableNonces(storage, now)
    const seen = await storage.get(`${DURABLE_NONCE_PREFIX}${nonceKey}`)
    if (typeof seen === 'number' && seen >= now) return false  // replay detected
  } else {
    pruneNonces(now)
    if (usedNonces.has(nonceKey)) return false  // replay detected
  }

  try {
    const msg    = `${ts}.${action}.${nonce}`
    const key    = await getHmacKey(secret)
    const sigBuf = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    const ok     = await crypto.subtle.verify('HMAC', key, sigBuf, new TextEncoder().encode(msg))
    if (!ok) return false
    if (storage) {
      await storage.put(`${DURABLE_NONCE_PREFIX}${nonceKey}`, ts + ttlS)
    } else {
      usedNonces.set(nonceKey, ts + ttlS)
    }
    return true
  } catch {
    return false
  }
}
