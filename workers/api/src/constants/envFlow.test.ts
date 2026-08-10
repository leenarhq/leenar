import { describe, it, expect } from 'vitest'
import { resolveEnvKeys, ENV_FLOW, ALL_CLIENT_PREFIXES } from './envFlow'

describe('resolveEnvKeys', () => {
  it('shotguns all known prefixes for a public base on a client target when framework is unknown', () => {
    // Derived from ALL_CLIENT_PREFIXES so adding a framework can't silently drift this.
    expect(resolveEnvKeys(['SUPABASE_URL'], 'vercel'))
      .toEqual(ALL_CLIENT_PREFIXES.map((p) => p + 'SUPABASE_URL'))
    // The common three must always be present in the shotgun set.
    expect(resolveEnvKeys(['SUPABASE_URL'], 'vercel')).toEqual(
      expect.arrayContaining([
        'NEXT_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_URL', 'PUBLIC_SUPABASE_URL',
      ]),
    )
  })

  it('emits a single prefix for a known framework', () => {
    expect(resolveEnvKeys(['SUPABASE_URL'], 'vercel', 'vite')).toEqual(['VITE_SUPABASE_URL'])
    expect(resolveEnvKeys(['API_URL'], 'vercel', 'next')).toEqual(['NEXT_PUBLIC_API_URL'])
    expect(resolveEnvKeys(['WORKER_URL'], 'vercel', 'astro')).toEqual(['PUBLIC_WORKER_URL'])
    expect(resolveEnvKeys(['SUPABASE_URL'], 'vercel', 'nuxt')).toEqual(['NUXT_PUBLIC_SUPABASE_URL'])
    expect(resolveEnvKeys(['SUPABASE_URL'], 'vercel', 'gatsby')).toEqual(['GATSBY_SUPABASE_URL'])
    expect(resolveEnvKeys(['SUPABASE_URL'], 'vercel', 'cra')).toEqual(['REACT_APP_SUPABASE_URL'])
  })

  it('leaves server-only bases raw on a client target', () => {
    expect(resolveEnvKeys(['SUPABASE_SERVICE_ROLE_KEY'], 'vercel', 'vite'))
      .toEqual(['SUPABASE_SERVICE_ROLE_KEY'])
    expect(resolveEnvKeys(['GITHUB_OWNER'], 'vercel')).toEqual(['GITHUB_OWNER'])
  })

  it('never prefixes on a non-client target', () => {
    expect(resolveEnvKeys(['SUPABASE_URL'], 'cloudflare-workers', 'vite'))
      .toEqual(['SUPABASE_URL'])
  })

  it('ENV_FLOW holds base names only (no prefixed names)', () => {
    const all = Object.values(ENV_FLOW).flatMap((t) => Object.values(t)).flat()
    expect(all.some((k) => /^(NEXT_PUBLIC_|VITE_|PUBLIC_)/.test(k))).toBe(false)
    expect(ENV_FLOW['cloudflare-workers'].vercel).toEqual(['API_URL', 'WORKER_URL'])
  })
})
