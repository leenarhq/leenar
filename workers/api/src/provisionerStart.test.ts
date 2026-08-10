import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./doAuth', () => ({ signDoToken: vi.fn().mockResolvedValue('signed-token') }))

import { startProvisioner } from './provisionerStart'

function makeEnv(stubFetch: ReturnType<typeof vi.fn>) {
  return {
    INTERNAL_SECRET: 'x'.repeat(32),
    PROVISIONER: {
      idFromName: vi.fn().mockReturnValue('do-id'),
      get: vi.fn().mockReturnValue({ fetch: stubFetch }),
    },
  } as any
}

const STACK = 'aabbccdd-0000-0000-0000-000000000001'
const USER = 'aabbccdd-0000-0000-0000-000000000002'
const APPROVED = { projectName: 'p', steps: [] as any[] }

describe('startProvisioner', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns sessionId when the DO responds ok with a sessionId', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true, sessionId: 'sess-1' }))
    const out = await startProvisioner(makeEnv(fetch), STACK, USER, APPROVED)
    expect(out.sessionId).toBe('sess-1')
  })

  it('throws when the DO responds non-ok (e.g. 409) — never returns a partial result', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({ ok: false, error: 'already active' }, { status: 409 }),
    )
    await expect(startProvisioner(makeEnv(fetch), STACK, USER, APPROVED)).rejects.toThrow()
  })

  it('throws when the DO responds ok but the body has no sessionId', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }))
    await expect(startProvisioner(makeEnv(fetch), STACK, USER, APPROVED)).rejects.toThrow()
  })
})
