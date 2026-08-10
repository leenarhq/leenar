import { describe, it, expect, vi, afterEach } from 'vitest'
import { isUUID, redactSecretsFromText, isSecretKey, timingSafeEqual, auditLog } from './utils'
import { bearerToken } from './auth'
import type { Env } from './types'

describe('isUUID', () => {
  it('accepts valid v4 UUIDs', () => {
    expect(isUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    expect(isUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true)
    expect(isUUID('00000000-0000-0000-0000-000000000000')).toBe(true)
    expect(isUUID('ffffffff-ffff-ffff-ffff-ffffffffffff')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true)
    expect(isUUID('550e8400-E29B-41d4-A716-446655440000')).toBe(true)
  })

  it('rejects non-UUID strings', () => {
    expect(isUUID('')).toBe(false)
    expect(isUUID('not-a-uuid')).toBe(false)
    expect(isUUID('550e8400-e29b-41d4-a716')).toBe(false)
    expect(isUUID('550e8400e29b41d4a716446655440000')).toBe(false)  // no hyphens
    expect(isUUID('550e8400-e29b-41d4-a716-44665544000g')).toBe(false)  // invalid char
    expect(isUUID('550e8400-e29b-41d4-a716-4466554400000')).toBe(false)  // too long
  })

  it('rejects SQL injection and special chars', () => {
    expect(isUUID("'; DROP TABLE--")).toBe(false)
    expect(isUUID('../../etc/passwd')).toBe(false)
    expect(isUUID('<script>')).toBe(false)
  })
})

describe('bearerToken', () => {
  it('extracts token from valid Authorization header', () => {
    const req = new Request('https://api.example.com/', {
      headers: { Authorization: 'Bearer my-token-value' },
    })
    expect(bearerToken(req)).toBe('my-token-value')
  })

  it('returns null when Authorization header is absent', () => {
    const req = new Request('https://api.example.com/')
    expect(bearerToken(req)).toBeNull()
  })

  it('returns null for non-Bearer auth schemes', () => {
    const req = new Request('https://api.example.com/', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    })
    expect(bearerToken(req)).toBeNull()
  })

  it('returns null for malformed Bearer header without trailing space', () => {
    const req = new Request('https://api.example.com/', {
      headers: { Authorization: 'Bearer' },  // no space → startsWith('Bearer ') fails → null
    })
    expect(bearerToken(req)).toBeNull()
  })

  it('handles token with special characters', () => {
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature'
    const req = new Request('https://api.example.com/', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(bearerToken(req)).toBe(token)
  })
})

describe('redactSecretsFromText', () => {
  it('replaces every occurrence of a known secret value with [REDACTED]', () => {
    const text = 'auth failed: sk-secret-abc is invalid (got sk-secret-abc)'
    expect(redactSecretsFromText(text, ['sk-secret-abc'])).toBe(
      'auth failed: [REDACTED] is invalid (got [REDACTED])',
    )
  })

  it('redacts multiple distinct secrets in the same text', () => {
    const text = 'token1 and token2 both rejected'
    expect(redactSecretsFromText(text, ['token1', 'token2'])).toBe(
      '[REDACTED] and [REDACTED] both rejected',
    )
  })

  it('ignores undefined/empty entries in the secrets list', () => {
    const text = 'no secrets here'
    expect(redactSecretsFromText(text, [undefined, '', undefined])).toBe(text)
  })

  it('returns the text unchanged when no secret matches', () => {
    const text = 'a generic error message'
    expect(redactSecretsFromText(text, ['sk-unrelated'])).toBe(text)
  })
})

describe('isSecretKey', () => {
  it('matches common secret-shaped key names', () => {
    expect(isSecretKey('secret')).toBe(true)
    expect(isSecretKey('password')).toBe(true)
    expect(isSecretKey('SUPABASE_SERVICE_ROLE_KEY')).toBe(true)
    expect(isSecretKey('access_token')).toBe(true)
    expect(isSecretKey('API_KEY')).toBe(true)
    expect(isSecretKey('resend_api_key')).toBe(true)
  })

  it('does not match benign, non-secret key names', () => {
    expect(isSecretKey('supabase_url')).toBe(false)
    expect(isSecretKey('cloudflare_worker_url')).toBe(false)
    expect(isSecretKey('cloudflare_account_id')).toBe(false)
    expect(isSecretKey('project_name')).toBe(false)
  })
})

describe('timingSafeEqual', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true)
  })
  it('returns false for different content of equal length', () => {
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false)
  })
  it('returns false for different lengths', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
  })
})

describe('auditLog source attribution', () => {
  afterEach(() => vi.unstubAllGlobals())

  const baseEnv = {
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
  }

  it('overrides metadata.source with env._auditSource when set', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    auditLog({ ...baseEnv, _auditSource: 'slack' } as Env, 'u1', 'workflow_created', {
      source: 'mcp',
      projectId: 'p1',
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.metadata.source).toBe('slack')
    expect(body.metadata.projectId).toBe('p1')
  })

  it('keeps the handler-provided source when there is no override', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    auditLog(baseEnv as Env, 'u1', 'workflow_created', { source: 'mcp' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.metadata.source).toBe('mcp')
  })
})

describe('auditLog channel tagging', () => {
  afterEach(() => vi.unstubAllGlobals())

  const baseEnv = {
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'svc',
  }

  function writeAndReadChannel(env: Partial<Env>): string | undefined {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    auditLog(env as Env, 'u1', 'workflow_created', {})
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    return body.channel
  }

  it('writes the transport-derived channel (_auditChannel) as a top-level column', () => {
    expect(writeAndReadChannel({ ...baseEnv, _auditChannel: 'web' })).toBe('web')
    expect(writeAndReadChannel({ ...baseEnv, _auditChannel: 'mcp' })).toBe('mcp')
  })

  it('prefers the explicit agent/channel source (_auditSource) over _auditChannel', () => {
    expect(
      writeAndReadChannel({ ...baseEnv, _auditSource: 'slack', _auditChannel: 'web' }),
    ).toBe('slack')
    expect(
      writeAndReadChannel({ ...baseEnv, _auditSource: 'agent', _auditChannel: 'mcp' }),
    ).toBe('agent')
  })

  it('omits channel when neither source nor transport is known', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    auditLog(baseEnv as Env, 'u1', 'workflow_created', {})
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect('channel' in body).toBe(false)
  })
})
