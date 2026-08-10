import { describe, it, expect, vi, afterEach } from 'vitest'
import { verifyJWT, bearerToken, classifyAuthFailure } from './auth'

// ── Helpers ──────────────────────────────────────────────────────────────────

function b64url(data: string | Uint8Array): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const b64 = btoa(String.fromCharCode(...bytes))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function signHS256(header: object, payload: object, secret: string): Promise<string> {
  const h = b64url(JSON.stringify(header))
  const p = b64url(JSON.stringify(payload))
  const msg = new TextEncoder().encode(`${h}.${p}`)
  let keyBytes: Uint8Array
  try {
    keyBytes = Uint8Array.from(atob(secret), c => c.charCodeAt(0))
  } catch {
    keyBytes = new TextEncoder().encode(secret)
  }
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg))
  const s = b64url(sig)
  return `${h}.${p}.${s}`
}

async function signES256(
  header: object,
  payload: object,
  privateKey: CryptoKey,
): Promise<string> {
  const h = b64url(JSON.stringify(header))
  const p = b64url(JSON.stringify(payload))
  const msg = new TextEncoder().encode(`${h}.${p}`)
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, msg),
  )
  return `${h}.${p}.${b64url(sig)}`
}

async function makeEcKeypair() {
  const keyPair = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
  return { privateKey: keyPair.privateKey, publicJwk }
}

const SECRET = 'test-secret-for-jwt'
const USER_ID = '00000000-0000-0000-0000-000000000001'
const SUPABASE_URL = 'https://fake.supabase.co'
const future = Math.floor(Date.now() / 1000) + 3600
const past   = Math.floor(Date.now() / 1000) - 10

// ── bearerToken ───────────────────────────────────────────────────────────────

describe('bearerToken', () => {
  it('returns token from valid Authorization header', () => {
    const req = new Request('https://x/', {
      headers: { Authorization: 'Bearer my-token-123' },
    })
    expect(bearerToken(req)).toBe('my-token-123')
  })

  it('returns null when Authorization header is missing', () => {
    expect(bearerToken(new Request('https://x/'))).toBeNull()
  })

  it('returns null for non-Bearer scheme', () => {
    const req = new Request('https://x/', { headers: { Authorization: 'Basic abc' } })
    expect(bearerToken(req)).toBeNull()
  })
})

// ── verifyJWT ─────────────────────────────────────────────────────────────────

describe('verifyJWT — HS256', () => {
  it('verifies a valid HS256 token and returns payload', async () => {
    const token = await signHS256(
      { alg: 'HS256', typ: 'JWT' },
      { sub: USER_ID, exp: future, role: 'authenticated', aud: 'authenticated' },
      SECRET,
    )
    const res = await verifyJWT(token, SECRET, SUPABASE_URL)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.payload.sub).toBe(USER_ID)
  })

  it('returns ok:false reason:expired on expired token', async () => {
    const token = await signHS256(
      { alg: 'HS256', typ: 'JWT' },
      { sub: USER_ID, exp: past, role: 'authenticated', aud: 'authenticated' },
      SECRET,
    )
    const res = await verifyJWT(token, SECRET, SUPABASE_URL)
    expect(res).toEqual({ ok: false, reason: 'expired' })
  })

  it('returns ok:false reason:invalid_signature on wrong secret', async () => {
    const token = await signHS256(
      { alg: 'HS256', typ: 'JWT' },
      { sub: USER_ID, exp: future, role: 'authenticated', aud: 'authenticated' },
      SECRET,
    )
    const res = await verifyJWT(token, 'wrong-secret', SUPABASE_URL)
    expect(res).toEqual({ ok: false, reason: 'invalid_signature' })
  })

  it('returns ok:false reason:invalid_signature on tampered signature', async () => {
    const token = await signHS256(
      { alg: 'HS256', typ: 'JWT' },
      { sub: USER_ID, exp: future, role: 'authenticated', aud: 'authenticated' },
      SECRET,
    )
    // Flip the FIRST char of the signature segment — payload/header stay
    // well-formed so this exercises signature verification specifically, not
    // JSON parsing. Must be the first char, not the last: a 32-byte HMAC encodes
    // to 43 base64url chars where the final char carries only 4 significant bits
    // (2 are padding), so flipping it can decode to the same bytes and leave the
    // signature unchanged — a flaky no-op. The first char is fully significant.
    const parts = token.split('.')
    parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1)
    const res = await verifyJWT(parts.join('.'), SECRET, SUPABASE_URL)
    expect(res).toEqual({ ok: false, reason: 'invalid_signature' })
  })

  it('returns ok:false reason:malformed on malformed token (missing segments)', async () => {
    const res = await verifyJWT('not.a.valid', SECRET, SUPABASE_URL)
    expect(res).toEqual({ ok: false, reason: 'malformed' })
  })

  it('returns ok:false reason:bad_alg on unsupported algorithm', async () => {
    const h = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const p = b64url(JSON.stringify({ sub: USER_ID, exp: future }))
    const token = `${h}.${p}.fakesig`
    const res = await verifyJWT(token, SECRET, SUPABASE_URL)
    expect(res).toEqual({ ok: false, reason: 'bad_alg' })
  })
})

describe('verifyJWT — ES256 (JWK hardening)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('accepts a valid ES256 token whose JWK has correct kty/crv/alg/use', async () => {
    const { privateKey, publicJwk } = await makeEcKeypair()
    const kid = 'kid-valid-1'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ keys: [{ ...publicJwk, alg: 'ES256', use: 'sig', kid }] }),
        ),
      ),
    )
    const token = await signES256(
      { alg: 'ES256', typ: 'JWT', kid },
      { sub: USER_ID, exp: future, aud: 'authenticated' },
      privateKey,
    )
    const res = await verifyJWT(token, SECRET, SUPABASE_URL)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.payload.sub).toBe(USER_ID)
  })

  it('accepts a valid ES256 token whose JWK omits alg/use (still kty/crv-valid)', async () => {
    const { privateKey, publicJwk } = await makeEcKeypair()
    const kid = 'kid-valid-2'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ keys: [{ ...publicJwk, kid }] }))),
    )
    const token = await signES256(
      { alg: 'ES256', typ: 'JWT', kid },
      { sub: USER_ID, exp: future, aud: 'authenticated' },
      privateKey,
    )
    const res = await verifyJWT(token, SECRET, SUPABASE_URL)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.payload.sub).toBe(USER_ID)
  })

  it('rejects a JWK with the wrong kty', async () => {
    const { publicJwk } = await makeEcKeypair()
    const kid = 'kid-bad-kty'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ keys: [{ ...publicJwk, kty: 'RSA', kid }] })),
      ),
    )
    const h = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }))
    const p = b64url(JSON.stringify({ sub: USER_ID, exp: future, aud: 'authenticated' }))
    const token = `${h}.${p}.fakesig`
    const res = await verifyJWT(token, SECRET, SUPABASE_URL)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('bad_key')
  })

  it('rejects a JWK with the wrong crv', async () => {
    const { publicJwk } = await makeEcKeypair()
    const kid = 'kid-bad-crv'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ keys: [{ ...publicJwk, crv: 'P-384', kid }] })),
      ),
    )
    const h = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }))
    const p = b64url(JSON.stringify({ sub: USER_ID, exp: future, aud: 'authenticated' }))
    const token = `${h}.${p}.fakesig`
    const res = await verifyJWT(token, SECRET, SUPABASE_URL)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('bad_key')
  })

  it('rejects a JWK whose alg does not match ES256', async () => {
    const { publicJwk } = await makeEcKeypair()
    const kid = 'kid-bad-alg'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ keys: [{ ...publicJwk, alg: 'ES384', kid }] })),
      ),
    )
    const h = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }))
    const p = b64url(JSON.stringify({ sub: USER_ID, exp: future, aud: 'authenticated' }))
    const token = `${h}.${p}.fakesig`
    const res = await verifyJWT(token, SECRET, SUPABASE_URL)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('bad_key')
  })

  it('rejects a JWK whose use is not "sig"', async () => {
    const { publicJwk } = await makeEcKeypair()
    const kid = 'kid-bad-use'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ keys: [{ ...publicJwk, use: 'enc', kid }] })),
      ),
    )
    const h = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }))
    const p = b64url(JSON.stringify({ sub: USER_ID, exp: future, aud: 'authenticated' }))
    const token = `${h}.${p}.fakesig`
    const res = await verifyJWT(token, SECRET, SUPABASE_URL)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('bad_key')
  })

  it('classifies a kid that is absent from the JWKS as bad_key (not infra)', async () => {
    const { publicJwk } = await makeEcKeypair()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: 'some-other-kid' }] })),
      ),
    )
    const h = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'kid-not-present' }))
    const p = b64url(JSON.stringify({ sub: USER_ID, exp: future, aud: 'authenticated' }))
    const token = `${h}.${p}.fakesig`
    const res = await verifyJWT(token, SECRET, SUPABASE_URL)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('bad_key')
  })

  it('still THROWS (infra, not attack) when the JWKS endpoint is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('upstream down', { status: 503 })),
    )
    const h = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'kid-x' }))
    const p = b64url(JSON.stringify({ sub: USER_ID, exp: future, aud: 'authenticated' }))
    const token = `${h}.${p}.fakesig`
    await expect(verifyJWT(token, SECRET, SUPABASE_URL)).rejects.toThrow('Failed to fetch JWKS')
  })
})

describe('verifyJWT result shape', () => {
  it('returns ok:true with payload for a valid HS256 token', async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = await signHS256(
      { alg: 'HS256', typ: 'JWT' },
      { sub: USER_ID, aud: 'authenticated', exp: now + 3600, iss: `${SUPABASE_URL}/auth/v1` },
      SECRET,
    )
    const res = await verifyJWT(token, SECRET, SUPABASE_URL)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.payload.sub).toBe(USER_ID)
  })

  it('returns ok:false reason:expired for a signature-valid expired token', async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = await signHS256(
      { alg: 'HS256', typ: 'JWT' },
      { sub: USER_ID, aud: 'authenticated', exp: now - 10, iss: `${SUPABASE_URL}/auth/v1` },
      SECRET,
    )
    const res = await verifyJWT(token, SECRET, SUPABASE_URL)
    expect(res).toEqual({ ok: false, reason: 'expired' })
  })

  it('returns ok:false reason:invalid_signature when the secret is wrong', async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = await signHS256(
      { alg: 'HS256', typ: 'JWT' },
      { sub: USER_ID, aud: 'authenticated', exp: now + 3600, iss: `${SUPABASE_URL}/auth/v1` },
      SECRET,
    )
    const res = await verifyJWT(token, 'a-different-secret', SUPABASE_URL)
    expect(res).toEqual({ ok: false, reason: 'invalid_signature' })
  })

  it('returns ok:false reason:malformed for a non-JWT string', async () => {
    const res = await verifyJWT('not.a.jwt', SECRET, SUPABASE_URL)
    expect(res).toEqual({ ok: false, reason: 'malformed' })
  })

  it('returns ok:false reason:bad_alg for alg:none', async () => {
    const now = Math.floor(Date.now() / 1000)
    const h = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0' // {"alg":"none","typ":"JWT"}
    const p = btoa(JSON.stringify({ sub: USER_ID, aud: 'authenticated', exp: now + 3600 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const res = await verifyJWT(`${h}.${p}.`, SECRET, SUPABASE_URL)
    expect(res).toEqual({ ok: false, reason: 'bad_alg' })
  })

  it('returns ok:false reason:bad_claims for a valid signature with wrong audience', async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = await signHS256(
      { alg: 'HS256', typ: 'JWT' },
      { sub: USER_ID, aud: 'anon', exp: now + 3600, iss: `${SUPABASE_URL}/auth/v1` },
      SECRET,
    )
    const res = await verifyJWT(token, SECRET, SUPABASE_URL)
    expect(res).toEqual({ ok: false, reason: 'bad_claims' })
  })
})

describe('classifyAuthFailure', () => {
  it('treats a signature-valid expired token as benign (not logged)', () => {
    const c = classifyAuthFailure('expired')
    expect(c.logAsSecurityEvent).toBe(false)
    expect(c.responseCode).toBe('token_expired')
  })

  it('treats a bad signature as attack traffic (logged)', () => {
    const c = classifyAuthFailure('invalid_signature')
    expect(c.logAsSecurityEvent).toBe(true)
    expect(c.securityReason).toBe('auth_invalid_signature')
    expect(c.responseCode).toBe('invalid_token')
  })

  it('logs malformed, bad_alg and bad_claims as distinct attack reasons', () => {
    expect(classifyAuthFailure('malformed').securityReason).toBe('auth_malformed')
    expect(classifyAuthFailure('bad_alg').securityReason).toBe('auth_bad_alg')
    expect(classifyAuthFailure('bad_claims').securityReason).toBe('auth_bad_claims')
    for (const r of ['malformed', 'bad_alg', 'bad_claims'] as const) {
      expect(classifyAuthFailure(r).logAsSecurityEvent).toBe(true)
      expect(classifyAuthFailure(r).responseCode).toBe('invalid_token')
    }
  })

  it('classifies bad_key as a logged attack', () => {
    const c = classifyAuthFailure('bad_key')
    expect(c.logAsSecurityEvent).toBe(true)
    expect(c.securityReason).toBe('auth_bad_key')
    expect(c.responseCode).toBe('invalid_token')
  })
})
