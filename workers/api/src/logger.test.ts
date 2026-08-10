import { describe, it, expect, vi, afterEach } from 'vitest'
import { createLogger } from './logger'

afterEach(() => vi.restoreAllMocks())

describe('createLogger', () => {
  it('emits info as JSON to console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const logger = createLogger({ service: 'test' })
    logger.info('hello world', { count: 5 })

    expect(spy).toHaveBeenCalledOnce()
    const parsed = JSON.parse(spy.mock.calls[0][0] as string)
    expect(parsed.level).toBe('info')
    expect(parsed.msg).toBe('hello world')
    expect(parsed.service).toBe('test')
    expect(parsed.count).toBe(5)
    expect(typeof parsed.ts).toBe('string')
  })

  it('emits warn to console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    createLogger().warn('watch out')
    expect(spy).toHaveBeenCalledOnce()
    expect(JSON.parse(spy.mock.calls[0][0] as string).level).toBe('warn')
  })

  it('emits error to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    createLogger().error('boom', { code: 500 })
    expect(spy).toHaveBeenCalledOnce()
    const parsed = JSON.parse(spy.mock.calls[0][0] as string)
    expect(parsed.level).toBe('error')
    expect(parsed.code).toBe(500)
  })

  it('emits debug to console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    createLogger().debug('trace detail')
    expect(spy).toHaveBeenCalledOnce()
    expect(JSON.parse(spy.mock.calls[0][0] as string).level).toBe('debug')
  })

  it('child logger inherits base fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const parent = createLogger({ request: 'req-1' })
    const child  = parent.child({ step: 2 })
    child.info('child msg')

    const parsed = JSON.parse(spy.mock.calls[0][0] as string)
    expect(parsed.request).toBe('req-1')
    expect(parsed.step).toBe(2)
    expect(parsed.msg).toBe('child msg')
  })

  it('child fields override parent fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const parent = createLogger({ env: 'prod' })
    parent.child({ env: 'test' }).info('override')
    expect(JSON.parse(spy.mock.calls[0][0] as string).env).toBe('test')
  })

  it('produces valid ISO timestamp', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    createLogger().info('ts check')
    const { ts } = JSON.parse(spy.mock.calls[0][0] as string)
    expect(new Date(ts).getTime()).toBeGreaterThan(0)
  })
})
