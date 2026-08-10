import { describe, it, expect } from 'vitest'
import { detectFramework, hasWranglerConfig } from './detectFramework'

describe('detectFramework', () => {
  it('detects next from next.config', () => {
    expect(detectFramework({ rootFiles: ['next.config.mjs', 'package.json'] })).toBe('next')
  })
  it('detects vite from app.config (TanStack Start) or vite.config', () => {
    expect(detectFramework({ rootFiles: ['app.config.ts'] })).toBe('vite')
    expect(detectFramework({ rootFiles: ['vite.config.ts'] })).toBe('vite')
  })
  it('detects astro from astro.config', () => {
    expect(detectFramework({ rootFiles: ['astro.config.mjs'] })).toBe('astro')
  })
  it('config files beat a transitive vite dependency (Next app)', () => {
    expect(detectFramework({
      rootFiles: ['next.config.js'],
      packageJson: { dependencies: { next: '14', vite: '5' } },
    })).toBe('next')
  })
  it('detects svelte, not vite, for a SvelteKit repo (uses PUBLIC_ prefix)', () => {
    // SvelteKit repos carry both svelte.config and vite.config; svelte must win.
    expect(detectFramework({ rootFiles: ['svelte.config.js', 'vite.config.ts'] })).toBe('svelte')
    // Dep fallback: @sveltejs/kit lists vite too — svelte must still win.
    expect(detectFramework({
      rootFiles: ['package.json'],
      packageJson: { devDependencies: { '@sveltejs/kit': '2', vite: '5' } },
    })).toBe('svelte')
  })
  it('matches modern .mts/.cts config extensions', () => {
    expect(detectFramework({ rootFiles: ['next.config.mts'] })).toBe('next')
    expect(detectFramework({ rootFiles: ['vite.config.mts'] })).toBe('vite')
  })
  it('detects nuxt, not vite, for a Nuxt repo (uses NUXT_PUBLIC_ prefix)', () => {
    // Nuxt bundles vite; nuxt.config must win over a stray vite.config.
    expect(detectFramework({ rootFiles: ['nuxt.config.ts', 'vite.config.ts'] })).toBe('nuxt')
    expect(detectFramework({ rootFiles: ['package.json'],
      packageJson: { dependencies: { nuxt: '3', vite: '5' } } })).toBe('nuxt')
  })
  it('detects gatsby from gatsby-config or dependency (uses GATSBY_ prefix)', () => {
    expect(detectFramework({ rootFiles: ['gatsby-config.js'] })).toBe('gatsby')
    expect(detectFramework({ rootFiles: ['package.json'],
      packageJson: { dependencies: { gatsby: '5' } } })).toBe('gatsby')
  })
  it('detects CRA from react-scripts dependency (no config file, uses REACT_APP_)', () => {
    expect(detectFramework({ rootFiles: ['package.json'],
      packageJson: { dependencies: { 'react-scripts': '5', react: '18' } } })).toBe('cra')
  })
  it('falls back to dependencies when no config file', () => {
    expect(detectFramework({ rootFiles: ['package.json'],
      packageJson: { dependencies: { '@tanstack/react-start': '1' } } })).toBe('vite')
    expect(detectFramework({ rootFiles: [], packageJson: { dependencies: { next: '14' } } })).toBe('next')
    expect(detectFramework({ rootFiles: [], packageJson: { devDependencies: { astro: '4' } } })).toBe('astro')
  })
  it('checks subdir files for monorepos', () => {
    expect(detectFramework({ rootFiles: ['package.json'], subdirFiles: ['vite.config.ts'] })).toBe('vite')
  })
  it('returns undefined when no signal', () => {
    expect(detectFramework({ rootFiles: ['README.md'], packageJson: { dependencies: {} } })).toBeUndefined()
  })
  it('detects wrangler config presence', () => {
    expect(hasWranglerConfig(['wrangler.toml'])).toBe(true)
    expect(hasWranglerConfig(['wrangler.jsonc'])).toBe(true)
    expect(hasWranglerConfig(['package.json'])).toBe(false)
  })
})
