import { describe, it, expect, vi, afterEach } from 'vitest'
import { listDomains } from './resend'

afterEach(() => vi.restoreAllMocks())

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }))
}

describe('listDomains', () => {
  it('returns domains when API returns array directly', async () => {
    mockFetch(200, [
      { id: 'd1', name: 'example.com', status: 'verified', region: 'eu-west-1', created_at: '2026-01-01' },
    ])
    const domains = await listDomains('tok')
    expect(domains).toHaveLength(1)
    expect(domains[0].name).toBe('example.com')
    expect(domains[0].status).toBe('verified')
  })

  it('returns domains when API returns {data: [...]} envelope', async () => {
    mockFetch(200, {
      data: [
        { id: 'd2', name: 'other.io', status: 'pending', region: 'us-east-1', created_at: '2026-02-01' },
      ],
    })
    const domains = await listDomains('tok')
    expect(domains).toHaveLength(1)
    expect(domains[0].name).toBe('other.io')
  })

  it('returns empty array for empty data', async () => {
    mockFetch(200, [])
    expect(await listDomains('tok')).toEqual([])
  })

  it('throws on API error with message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Invalid API key' }),
    }))
    await expect(listDomains('bad-token')).rejects.toThrow('Invalid API key')
  })

  it('throws on API error with status fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('not json')),
    }))
    await expect(listDomains('tok')).rejects.toThrow('500')
  })
})
