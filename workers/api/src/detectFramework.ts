import type { Framework } from './constants/envFlow'

const CONFIG_RULES: Array<{ re: RegExp; fw: Framework }> = [
  { re: /^next\.config\.(js|ts|mjs|cjs|mts|cts)$/, fw: 'next' },
  // nuxt/gatsby MUST precede vite: Nuxt bundles vite internally, and both use a
  // distinct browser prefix (NUXT_PUBLIC_/GATSBY_), not VITE_. Match config first.
  { re: /^nuxt\.config\.(js|ts|mjs)$/, fw: 'nuxt' },
  { re: /^gatsby-config\.(js|ts|mjs)$/, fw: 'gatsby' },
  { re: /^astro\.config\.(js|ts|mjs|mts)$/, fw: 'astro' },
  // svelte MUST precede vite: a SvelteKit repo also carries vite.config, but its
  // browser env prefix is PUBLIC_, not VITE_. Match svelte.config first so it wins.
  { re: /^svelte\.config\.(js|ts|mjs)$/, fw: 'svelte' },
  { re: /^app\.config\.(js|ts)$/, fw: 'vite' }, // TanStack Start
  { re: /^vite\.config\.(js|ts|mjs|mts|cts)$/, fw: 'vite' },
]

function fromConfigFiles(files: string[]): Framework | undefined {
  // Priority order: next/astro win over vite (a next app can carry a vite config
  // in a sub-package). CONFIG_RULES is ordered accordingly.
  for (const rule of CONFIG_RULES) {
    if (files.some((f) => rule.re.test(f))) return rule.fw
  }
  return undefined
}

function fromDependencies(pkg: unknown): Framework | undefined {
  if (!pkg || typeof pkg !== 'object') return undefined
  const p = pkg as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const deps = { ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}) }
  if (deps['next']) return 'next'
  // nuxt/gatsby before vite: Nuxt lists vite transitively; both use their own prefix.
  if (deps['nuxt']) return 'nuxt'
  if (deps['gatsby']) return 'gatsby'
  if (deps['@tanstack/react-start'] || deps['@tanstack/start'] || deps['@tanstack/solid-start'])
    return 'vite'
  if (deps['astro']) return 'astro'
  // @sveltejs/kit before vite: SvelteKit lists vite too but uses the PUBLIC_ prefix.
  if (deps['@sveltejs/kit']) return 'svelte'
  // react-scripts = Create React App; no config file, dep is the only signal.
  if (deps['react-scripts']) return 'cra'
  if (deps['vite']) return 'vite'
  return undefined
}

/**
 * Detect the frontend framework of a repo so client env vars get the correct
 * prefix. Config files are authoritative (transitive deps can be misleading);
 * package.json dependencies are the fallback.
 */
export function detectFramework(input: {
  rootFiles: string[]
  subdirFiles?: string[]
  packageJson?: unknown
}): Framework | undefined {
  const files = [...input.rootFiles, ...(input.subdirFiles ?? [])]
  return fromConfigFiles(files) ?? fromDependencies(input.packageJson)
}

/** True when the repo carries a Cloudflare Worker config (recorded for future use). */
export function hasWranglerConfig(files: string[]): boolean {
  return files.some(
    (f) => f === 'wrangler.toml' || f === 'wrangler.jsonc' || f === 'wrangler.json',
  )
}
