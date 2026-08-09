import type { JWTPayload } from './types'

const KEY_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour — allows Supabase key rotations to take effect
const keyCache = new Map<string, { key: CryptoKey; cachedAt: number }>()

// Thrown by getEcPublicKey when the JWKS entry itself is rejected (wrong
// kty/crv/alg/use, or the requested kid is absent). This is an attack/forgery
// signal — distinct from a transient JWKS *fetch* failure, which is infra.
export class JwkValidationError extends Error {}

function b64urlToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
}

async function getEcPublicKey(supabaseUrl: string, kid: string): Promise<CryptoKey> {
  const entry = keyCache.get(kid)
  if (entry && Date.now() - entry.cachedAt < KEY_CACHE_TTL_MS) return entry.key

  let res = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)
  if (!res.ok) {
    // Single retry — guards against transient Supabase 5xx under isolate churn
    await new Promise((r) => setTimeout(r, 150))
    res = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)
    if (!res.ok) throw new Error('Failed to fetch JWKS')
  }

  const { keys } = await res.json<{ keys: (JsonWebKey & { kid: string })[] }>()
  const jwk = keys.find(k => k.kid === kid)
  if (!jwk) throw new JwkValidationError(`JWK kid not found: ${kid}`)
  // Pin the expected key type/curve/alg/use so a malicious or misconfigured
  // JWKS entry can't smuggle in a key ECDSA-P256 import would otherwise accept.
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') throw new JwkValidationError('Unexpected JWK kty/crv')
  if (jwk.alg !== undefined && jwk.alg !== 'ES256') throw new JwkValidationError('Unexpected JWK alg')
  if (jwk.use !== undefined && jwk.use !== 'sig') throw new JwkValidationError('Unexpected JWK use')

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )
  keyCache.set(kid, { key, cachedAt: Date.now() })
  return key
}

export type VerifyResult =
  | { ok: true; payload: JWTPayload }
  | { ok: false; reason: AuthFailReason }

const SUB_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function verifyJWT(
  token: string,
  secret: string,
  supabaseUrl: string,
): Promise<VerifyResult> {
  const parts = token.split('.')
  const [headerB64, payloadB64, sigB64] = parts
  if (parts.length !== 3 || !headerB64 || !payloadB64 || sigB64 === undefined) {
    return { ok: false, reason: 'malformed' }
  }

  let header: { alg: string; kid?: string }
  let payload: JWTPayload
  try {
    header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')))
    payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  let sig: Uint8Array
  try {
    sig = b64urlToBytes(sigB64)
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  let ok: boolean
  if (header.alg === 'ES256') {
    if (!header.kid) return { ok: false, reason: 'bad_alg' }
    let key: CryptoKey
    try {
      key = await getEcPublicKey(supabaseUrl, header.kid)
    } catch (e) {
      // JWK-validation rejection → forgery/attack signal, logged by the caller.
      if (e instanceof JwkValidationError) return { ok: false, reason: 'bad_key' }
      // Genuine JWKS fetch failure → infra error, re-thrown to the caller's catch.
      throw e
    }
    ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, data)
  } else if (header.alg === 'HS256') {
    let secretBytes: Uint8Array
    try {
      secretBytes = Uint8Array.from(atob(secret), c => c.charCodeAt(0))
    } catch {
      secretBytes = new TextEncoder().encode(secret)
    }
    const key = await crypto.subtle.importKey(
      'raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    )
    ok = await crypto.subtle.verify('HMAC', key, sig, data)
  } else {
    return { ok: false, reason: 'bad_alg' }
  }

  if (!ok) return { ok: false, reason: 'invalid_signature' }

  // Signature is valid past this point. Expiry is the only "benign" failure.
  const nowSec = Date.now() / 1000
  if (typeof payload.exp !== 'number' || payload.exp < nowSec) {
    return { ok: false, reason: 'expired' }
  }
  if (payload.nbf !== undefined && payload.nbf > nowSec) return { ok: false, reason: 'bad_claims' }
  if (payload.aud !== 'authenticated') return { ok: false, reason: 'bad_claims' }
  if (!payload.sub || !SUB_RE.test(payload.sub)) return { ok: false, reason: 'bad_claims' }
  if (payload.iss && !payload.iss.startsWith(supabaseUrl)) return { ok: false, reason: 'bad_claims' }

  return { ok: true, payload }
}

export function bearerToken(req: Request): string | null {
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  return auth.slice(7)
}

export type AuthFailReason =
  | 'expired'
  | 'invalid_signature'
  | 'malformed'
  | 'bad_alg'
  | 'bad_claims'
  | 'bad_key'

export interface AuthFailClassification {
  /** When false, do NOT write a security_events row — keeps benign expiry out of the ban score. */
  logAsSecurityEvent: boolean
  /** The reason string written to security_events.reason (attack failures only). */
  securityReason: string
  /** Machine-readable code returned to the client in the 401 body. */
  responseCode: string
}

export function classifyAuthFailure(reason: AuthFailReason): AuthFailClassification {
  // Signature verified but exp passed → a genuine Supabase token from a real
  // user whose session lapsed. Benign: never logged, never scored. The client
  // refreshes on `token_expired`.
  if (reason === 'expired') {
    return { logAsSecurityEvent: false, securityReason: 'auth_expired', responseCode: 'token_expired' }
  }
  // Everything else is forgery/scan-shaped → attack traffic, logged with a
  // specific reason so PR2 scoring can weight it.
  return {
    logAsSecurityEvent: true,
    securityReason: `auth_${reason}`,
    responseCode: 'invalid_token',
  }
}
