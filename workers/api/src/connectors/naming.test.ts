import { describe, it, expect } from 'vitest'
import { toProjectName } from './vercel'
import { toRepoName } from './github'

describe('toProjectName (Vercel slug)', () => {
  it('lowercases the name', () => {
    expect(toProjectName('MyApp')).toBe('myapp')
    expect(toProjectName('VERCEL PROJECT')).toBe('vercel-project')
  })

  it('replaces non-alphanumeric chars with hyphens and strips trailing ones', () => {
    expect(toProjectName('my app!')).toBe('my-app')  // trailing ! becomes hyphen, then stripped
    expect(toProjectName('hello@world')).toBe('hello-world')
    expect(toProjectName('foo_bar')).toBe('foo-bar')
  })

  it('collapses consecutive hyphens', () => {
    expect(toProjectName('hello   world')).toBe('hello-world')
    expect(toProjectName('a---b')).toBe('a-b')
    expect(toProjectName('foo!!bar')).toBe('foo-bar')
  })

  it('strips leading and trailing hyphens', () => {
    expect(toProjectName('!my-project!')).toBe('my-project')
    expect(toProjectName('-leading')).toBe('leading')
    expect(toProjectName('trailing-')).toBe('trailing')
  })

  it('truncates at 100 characters', () => {
    const long = 'a'.repeat(150)
    expect(toProjectName(long)).toHaveLength(100)
  })

  it('falls back to "my-project" for all-special chars', () => {
    expect(toProjectName('!!!')).toBe('my-project')
    expect(toProjectName('')).toBe('my-project')
    expect(toProjectName('---')).toBe('my-project')
  })

  it('preserves valid names unchanged', () => {
    expect(toProjectName('my-app')).toBe('my-app')
    expect(toProjectName('app123')).toBe('app123')
  })

  it('allows hyphens already in the name', () => {
    expect(toProjectName('my-next-app')).toBe('my-next-app')
  })
})

describe('toRepoName (GitHub repo slug)', () => {
  it('lowercases the name', () => {
    expect(toRepoName('MyRepo')).toBe('myrepo')
    expect(toRepoName('GITHUB PROJECT')).toBe('github-project')
  })

  it('replaces non-alphanumeric runs with a single hyphen', () => {
    expect(toRepoName('my repo')).toBe('my-repo')
    expect(toRepoName('hello_world')).toBe('hello-world')
    expect(toRepoName('hello   world')).toBe('hello-world')
    expect(toRepoName('foo@bar#baz')).toBe('foo-bar-baz')
  })

  it('strips leading and trailing hyphens', () => {
    expect(toRepoName('_leading')).toBe('leading')
    expect(toRepoName('trailing_')).toBe('trailing')
  })

  it('truncates at 100 characters', () => {
    const long = 'a'.repeat(150)
    expect(toRepoName(long)).toHaveLength(100)
  })

  it('falls back to "my-project" for empty or all-special input', () => {
    expect(toRepoName('')).toBe('my-project')
    expect(toRepoName('___')).toBe('my-project')
  })

  it('preserves valid names unchanged', () => {
    expect(toRepoName('my-repo')).toBe('my-repo')
    expect(toRepoName('leenar123')).toBe('leenar123')
  })
})
