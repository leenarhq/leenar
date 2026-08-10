import { describe, it, expect, vi, afterEach } from 'vitest'
import { __test } from './connections'

afterEach(() => vi.restoreAllMocks())

function stubFetch(handler: (url: string) => { status: number; body: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const { status, body } = handler(url)
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }
  }))
}

describe('identity extraction', () => {
  it('github → @login', async () => {
    stubFetch(() => ({ status: 200, body: { login: 'mahmutefedara', name: 'Efe' } }))
    const r = await __test.pingGitHub('tok')
    expect(r.status).toBe('valid')
    expect(r.account).toBe('@mahmutefedara')
    expect(r.accountDetail).toBe('Efe')
  })

  it('vercel → username + email detail', async () => {
    stubFetch(() => ({ status: 200, body: { user: { username: 'efe', email: 'efe@x.com', name: 'Efe' } } }))
    const r = await __test.pingVercel('tok')
    expect(r.account).toBe('efe')
    expect(r.accountDetail).toBe('efe@x.com')
  })

  it('supabase → first org name with +N when multiple', async () => {
    stubFetch((url) =>
      url.includes('/v1/organizations')
        ? { status: 200, body: [{ id: '1', name: 'Acme Org' }, { id: '2', name: 'Second' }] }
        : { status: 200, body: [] }, // /v1/projects ping
    )
    const r = await __test.pingSupabase('tok')
    expect(r.status).toBe('valid')
    expect(r.account).toBe('Acme Org +1')
  })

  it('cloudflare → account name', async () => {
    stubFetch((url) =>
      url.includes('/user/tokens/verify')
        ? { status: 200, body: { result: { status: 'active' } } }
        : { status: 200, body: { result: [{ id: 'a1', name: "Efe's Account" }] } }, // /accounts
    )
    const r = await __test.pingCloudflare('tok')
    expect(r.status).toBe('valid')
    expect(r.account).toBe("Efe's Account")
  })

  it('resend → no account', async () => {
    stubFetch(() => ({ status: 200, body: [] }))
    const r = await __test.pingResend('tok')
    expect(r.status).toBe('valid')
    expect(r.account).toBeUndefined()
  })

  it('identity failure keeps status, drops account (github body parse fails)', async () => {
    stubFetch(() => ({ status: 200, body: null }))
    const r = await __test.pingGitHub('tok')
    expect(r.status).toBe('valid')
    expect(r.account).toBeUndefined()
  })

  it('non-valid status skips identity (github 401)', async () => {
    stubFetch(() => ({ status: 401, body: {} }))
    const r = await __test.pingGitHub('tok')
    expect(r.status).toBe('expired')
    expect(r.account).toBeUndefined()
  })
})
