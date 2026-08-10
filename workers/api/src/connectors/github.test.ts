import { describe, it, expect } from 'vitest'
import { toRepoName } from './github'

describe('toRepoName', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(toRepoName('My Project')).toBe('my-project')
  })

  it('replaces special characters with hyphens', () => {
    expect(toRepoName('Hello_World!')).toBe('hello-world')
  })

  it('collapses consecutive separators into one hyphen', () => {
    expect(toRepoName('foo---bar')).toBe('foo-bar')
    expect(toRepoName('foo   bar')).toBe('foo-bar')
  })

  it('strips leading and trailing hyphens', () => {
    expect(toRepoName('--cool--')).toBe('cool')
  })

  it('falls back to "my-project" for empty or all-special input', () => {
    expect(toRepoName('')).toBe('my-project')
    expect(toRepoName('!!!!')).toBe('my-project')
  })

  it('truncates to 100 characters', () => {
    const long = 'a'.repeat(200)
    expect(toRepoName(long)).toHaveLength(100)
  })

  it('preserves numbers', () => {
    expect(toRepoName('project-42')).toBe('project-42')
  })
})
