import { describe, it, expect, vi, afterEach } from 'vitest'
import { signDoToken, verifyDoToken } from './doAuth'

const SECRET = 'test-internal-secret-at-least-32-chars-long'

describe('doAuth', () => {
  afterEach(() => vi.useRealTimers())

  it('verifies a freshly signed token', async () => {
    const token = await signDoToken(SECRET, 'start')
    expect(await verifyDoToken(token, SECRET, 'start')).toBe(true)
  })

  it('rejects a token signed with wrong secret', async () => {
    const token = await signDoToken(SECRET, 'start')
    expect(await verifyDoToken(token, 'wrong-secret-xxxxxxxxxxxxxxxxxxxxxxxxx', 'start')).toBe(false)
  })

  it('rejects an expired token (> 60s old)', async () => {
    vi.useFakeTimers()
    const token = await signDoToken(SECRET, 'start')
    vi.advanceTimersByTime(61_000)
    expect(await verifyDoToken(token, SECRET, 'start')).toBe(false)
  })

  it('rejects a malformed token', async () => {
    expect(await verifyDoToken('', SECRET, 'start')).toBe(false)
    expect(await verifyDoToken('nodot', SECRET, 'start')).toBe(false)
    expect(await verifyDoToken('NaN.abc', SECRET, 'start')).toBe(false)
  })

  it('rejects a future-dated token (clock skew > 60s)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 120_000)
    const token = await signDoToken(SECRET, 'start')
    vi.setSystemTime(Date.now() - 120_000)
    expect(await verifyDoToken(token, SECRET, 'start')).toBe(false)
  })

  it('rejects cross-action replay (start token used as cancel)', async () => {
    const token = await signDoToken(SECRET, 'start')
    expect(await verifyDoToken(token, SECRET, 'cancel')).toBe(false)
  })

  it('rejects same-token replay within TTL window', async () => {
    const token = await signDoToken(SECRET, 'start')
    expect(await verifyDoToken(token, SECRET, 'start')).toBe(true)
    expect(await verifyDoToken(token, SECRET, 'start')).toBe(false)
  })

  it('honors a custom ttlS: valid past the default 60s window, rejected past the custom one', async () => {
    vi.useFakeTimers()
    const token = await signDoToken(SECRET, 'mcp_confirm:user:tool:action')
    vi.advanceTimersByTime(120_000)
    expect(await verifyDoToken(token, SECRET, 'mcp_confirm:user:tool:action', undefined, 300)).toBe(true)
  })

  it('still rejects once past a custom ttlS', async () => {
    vi.useFakeTimers()
    const token = await signDoToken(SECRET, 'mcp_confirm:user:tool:action')
    vi.advanceTimersByTime(301_000)
    expect(await verifyDoToken(token, SECRET, 'mcp_confirm:user:tool:action', undefined, 300)).toBe(false)
  })
})
