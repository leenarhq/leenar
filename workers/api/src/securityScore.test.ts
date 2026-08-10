import { describe, it, expect } from 'vitest'
import { securityWeight, scoreEvents, classifyBlocks } from './securityScore'

describe('securityWeight', () => {
  it('weights forged-credential reasons heavily', () => {
    expect(securityWeight('auth_invalid_signature')).toBe(5)
    expect(securityWeight('auth_bad_claims')).toBe(5)
    expect(securityWeight('auth_bad_alg')).toBe(5)
    expect(securityWeight('auth_bad_key')).toBe(5)
  })

  it('weights malformed tokens lower (could be a broken client or a scan)', () => {
    expect(securityWeight('auth_malformed')).toBe(2)
  })

  it('weights volumetric rate-limit hits lowest (already 429-ed)', () => {
    expect(securityWeight('rate_limit')).toBe(1)
  })

  it('defaults unknown/legacy reasons to 1', () => {
    expect(securityWeight('auth_failure')).toBe(1)
    expect(securityWeight('blocked_path')).toBe(1)
    expect(securityWeight('something_new')).toBe(1)
  })
})

describe('scoreEvents', () => {
  it('sums the stored weight per IP', () => {
    const scores = scoreEvents([
      { ip: 'a', reason: 'auth_invalid_signature', weight: 5 },
      { ip: 'a', reason: 'auth_invalid_signature', weight: 5 },
      { ip: 'b', reason: 'rate_limit', weight: 1 },
    ])
    expect(scores.get('a')).toBe(10)
    expect(scores.get('b')).toBe(1)
  })

  it('falls back to securityWeight(reason) when weight is missing/null', () => {
    const scores = scoreEvents([
      { ip: 'a', reason: 'auth_bad_key' },
      { ip: 'a', reason: 'auth_malformed', weight: null },
    ])
    expect(scores.get('a')).toBe(7) // 5 (bad_key) + 2 (malformed)
  })
})

describe('classifyBlocks', () => {
  const empty = new Set<string>()
  function scores(entries: [string, number][]) { return new Map(entries) }

  it('ignores IPs below the app threshold', () => {
    const t = classifyBlocks(scores([['a', 14]]), empty, 15, 30, empty)
    expect(t.appBlocks).toEqual([])
    expect(t.cfBlocks).toEqual([])
  })

  it('app-blocks a score in [app, cf)', () => {
    const t = classifyBlocks(scores([['a', 20]]), empty, 15, 30, empty)
    expect(t.appBlocks).toEqual([{ ip: 'a', score: 20 }])
    expect(t.cfBlocks).toEqual([])
  })

  it('cf-blocks a score at/above the cf threshold', () => {
    const t = classifyBlocks(scores([['a', 30]]), empty, 15, 30, empty)
    expect(t.cfBlocks).toEqual([{ ip: 'a', score: 30 }])
    expect(t.appBlocks).toEqual([])
  })

  it('escalates a repeat app-blocked IP to cf even in the app band', () => {
    const t = classifyBlocks(scores([['a', 20]]), empty, 15, 30, new Set(['a']))
    expect(t.cfBlocks).toEqual([{ ip: 'a', score: 20 }])
    expect(t.appBlocks).toEqual([])
  })

  it('never blocks an allowlisted IP in either tier', () => {
    const t = classifyBlocks(scores([['a', 99]]), new Set(['a']), 15, 30, new Set(['a']))
    expect(t.appBlocks).toEqual([])
    expect(t.cfBlocks).toEqual([])
  })

  it('sorts each tier by score descending', () => {
    const t = classifyBlocks(scores([['a', 16], ['b', 25], ['c', 40], ['d', 31]]), empty, 15, 30, empty)
    expect(t.appBlocks.map(b => b.ip)).toEqual(['b', 'a'])
    expect(t.cfBlocks.map(b => b.ip)).toEqual(['c', 'd'])
  })
})
