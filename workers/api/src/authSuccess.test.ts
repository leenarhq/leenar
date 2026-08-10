import { describe, it, expect } from 'vitest'
import { shouldMarkAuthSuccess, AUTH_SUCCESS_THROTTLE_MS } from './authSuccess'

describe('shouldMarkAuthSuccess', () => {
  it('marks an unseen IP and records the timestamp', () => {
    const seen = new Map<string, number>()
    expect(shouldMarkAuthSuccess('1.2.3.4', 1000, seen, AUTH_SUCCESS_THROTTLE_MS)).toBe(true)
    expect(seen.get('1.2.3.4')).toBe(1000)
  })

  it('suppresses a repeat within the throttle window', () => {
    const seen = new Map<string, number>()
    shouldMarkAuthSuccess('1.2.3.4', 1000, seen, AUTH_SUCCESS_THROTTLE_MS)
    const t = 1000 + AUTH_SUCCESS_THROTTLE_MS - 1
    expect(shouldMarkAuthSuccess('1.2.3.4', t, seen, AUTH_SUCCESS_THROTTLE_MS)).toBe(false)
  })

  it('re-marks once the throttle window has elapsed', () => {
    const seen = new Map<string, number>()
    shouldMarkAuthSuccess('1.2.3.4', 1000, seen, AUTH_SUCCESS_THROTTLE_MS)
    const t = 1000 + AUTH_SUCCESS_THROTTLE_MS
    expect(shouldMarkAuthSuccess('1.2.3.4', t, seen, AUTH_SUCCESS_THROTTLE_MS)).toBe(true)
    expect(seen.get('1.2.3.4')).toBe(t)
  })

  it('never marks an unknown/empty IP', () => {
    const seen = new Map<string, number>()
    expect(shouldMarkAuthSuccess('unknown', 1000, seen, AUTH_SUCCESS_THROTTLE_MS)).toBe(false)
    expect(shouldMarkAuthSuccess('', 1000, seen, AUTH_SUCCESS_THROTTLE_MS)).toBe(false)
    expect(seen.size).toBe(0)
  })
})
