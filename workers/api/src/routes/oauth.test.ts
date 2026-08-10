import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../crypto')>()
  return { ...actual, encrypt: vi.fn().mockResolvedValue('enc-tok') }
})

import { safeReturnPath, hmacSign, hmacVerify, connectServiceWithToken } from './oauth'

describe('safeReturnPath — open redirect protection', () => {
  it('allows known prefixes', () => {
    expect(safeReturnPath('/dashboard')).toBe('/dashboard')
    expect(safeReturnPath('/workspace')).toBe('/workspace')
    expect(safeReturnPath('/integrations')).toBe('/integrations')
    expect(safeReturnPath('/settings')).toBe('/settings')
  })

  it('allows sub-paths under known prefixes', () => {
    expect(safeReturnPath('/dashboard/foo')).toBe('/dashboard/foo')
    expect(safeReturnPath('/workspace/123')).toBe('/workspace/123')
    expect(safeReturnPath('/settings/security')).toBe('/settings/security')
  })

  it('preserves query strings', () => {
    expect(safeReturnPath('/dashboard?connected=vercel')).toBe('/dashboard?connected=vercel')
    expect(safeReturnPath('/workspace/abc?tab=logs')).toBe('/workspace/abc?tab=logs')
  })

  it('rejects absolute URLs (open redirect attempt)', () => {
    expect(safeReturnPath('https://evil.com')).toBe('/')
    expect(safeReturnPath('http://evil.com/steal')).toBe('/')
    expect(safeReturnPath('//evil.com')).toBe('/')
  })

  it('rejects protocol-relative and scheme-based attacks', () => {
    expect(safeReturnPath('javascript:alert(1)')).toBe('/')
    expect(safeReturnPath('data:text/html,<script>')).toBe('/')
  })

  it('rejects path traversal attempts', () => {
    expect(safeReturnPath('/dashboard/../../../etc/passwd')).toBe('/')
    expect(safeReturnPath('/workspace//evil.com')).toBe('/')
  })

  it('rejects subtly malformed allowed-prefix paths', () => {
    // "/dashboard@evil.com" starts with /dashboard but host is evil.com
    expect(safeReturnPath('/dashboard@evil.com')).toBe('/')
    // "/dashboardevil" starts with /dashboard but not a valid sub-path
    expect(safeReturnPath('/dashboardevil')).toBe('/')
  })

  it('rejects empty or non-path input', () => {
    expect(safeReturnPath('')).toBe('/')
    expect(safeReturnPath('not-a-path')).toBe('/')
    expect(safeReturnPath('  ')).toBe('/')
  })

  it('rejects unknown top-level paths', () => {
    expect(safeReturnPath('/evil')).toBe('/')
    expect(safeReturnPath('/admin')).toBe('/')
    expect(safeReturnPath('/api/anything')).toBe('/')
  })
})

describe('OAuth state HMAC signing', () => {
  const KEY = 'test-key-at-least-32-characters-long'

  it('round-trips sign → verify with same key', async () => {
    const payload = JSON.stringify({ svc: 'vercel', userId: 'user-1', ts: Date.now() })
    const sig = await hmacSign(payload, KEY)
    expect(await hmacVerify(payload, sig, KEY)).toBe(true)
  })

  it('rejects verification with wrong key', async () => {
    const payload = 'test-payload'
    const sig = await hmacSign(payload, KEY)
    expect(await hmacVerify(payload, sig, 'different-key-xxxxxxxxxxxxxxxxxxxxx')).toBe(false)
  })

  it('rejects tampered payload', async () => {
    const payload = '{"svc":"vercel","ts":1000000}'
    const sig = await hmacSign(payload, KEY)
    const tampered = '{"svc":"github","ts":1000000}'
    expect(await hmacVerify(tampered, sig, KEY)).toBe(false)
  })

  it('produces different sigs for different payloads', async () => {
    const sig1 = await hmacSign('payload-a', KEY)
    const sig2 = await hmacSign('payload-b', KEY)
    expect(sig1).not.toBe(sig2)
  })

  it('returns false for malformed signature gracefully', async () => {
    expect(await hmacVerify('payload', 'not-base64!!!', KEY)).toBe(false)
  })
})

describe('connectServiceWithToken — stale OAuth field cleanup', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('clears expires_at and refresh_token_enc when saving a PAT', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> | null }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) => {
        calls.push({
          url: String(url),
          body: init?.body ? JSON.parse(init.body as string) : null,
        })
        return new Response(null, { status: 201 })
      }),
    )
    const env = {
      SUPABASE_URL: 'https://supabase.test',
      SUPABASE_SERVICE_ROLE_KEY: 'svc-key',
      ENCRYPTION_KEY: 'k',
    } as never

    const result = await connectServiceWithToken('supabase', 'sbp_pat_123', 'user-1', env)

    expect(result).toEqual({ ok: true, service: 'supabase' })
    const save = calls.find((c) => c.url.includes('/rest/v1/user_connections'))
    expect(save).toBeDefined()
    expect(save!.body!.access_token_enc).toBe('enc-tok')
    // The two fields under test — a PAT has no expiry and no refresh token,
    // and stale OAuth values must not survive the upsert:
    expect(save!.body!.expires_at).toBeNull()
    expect(save!.body!.refresh_token_enc).toBeNull()
  })
})
