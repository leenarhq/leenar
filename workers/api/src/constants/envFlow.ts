/**
 * ENV_FLOW defines which env vars are injected from one service to another
 * when a canvas edge connects them during provisioning.
 *
 * IMPORTANT: This is the single source of truth.
 * - Values are framework-agnostic BASE names. Expand them into the final
 *   prefixed names (NEXT_PUBLIC_/VITE_/PUBLIC_) with `resolveEnvKeys` below —
 *   public bases only get a prefix on a CLIENT_FRAMEWORK_TARGET (e.g. vercel).
 * - No default fallbacks — only explicit pair-based rules.
 * - edge.data.envVars overrides ENV_FLOW at provision time (literal final names).
 * - DEFERRED_INJECTION_TARGETS: these providers cannot receive env injection yet
 *   (requires provider Management API integration — planned enhancement).
 * - Frontend mirror: apps/web/src/lib/envFlow.ts — regenerate with `npm run sync-env-flow`.
 */
export const ENV_FLOW: Record<string, Record<string, string[]>> = {
  supabase: {
    vercel:              ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
    'cloudflare-workers': ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
  },
  github: {
    vercel:              ['GITHUB_OWNER', 'GITHUB_REPO'],
    'cloudflare-workers': ['GITHUB_REPO_URL', 'GITHUB_OWNER', 'GITHUB_REPO'],
  },
  resend: {
    'cloudflare-workers': ['RESEND_API_KEY'],
    vercel:               ['RESEND_API_KEY'],
    // supabase SMTP injection deferred — Supabase is in DEFERRED_INJECTION_TARGETS
  },
  'cloudflare-workers': {
    vercel: ['API_URL', 'WORKER_URL'],
  },
  vercel: {
    'cloudflare-workers': ['ALLOWED_ORIGIN', 'FRONTEND_URL'],
  },
  'cloudflare-r2': {
    vercel:   ['R2_BUCKET_NAME', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'],
    // supabase injection deferred — Supabase is in DEFERRED_INJECTION_TARGETS
  },
}

/** Base names that are browser-exposed and get a framework prefix on a client target. */
export const PUBLIC_ENV_BASES = new Set<string>([
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'API_URL', 'WORKER_URL',
])

/** Target services whose client env is framework-prefixed at build time. */
export const CLIENT_FRAMEWORK_TARGETS = new Set<string>(['vercel'])

export type Framework = 'next' | 'vite' | 'astro' | 'svelte' | 'nuxt' | 'gatsby' | 'cra'

/** Framework id -> browser env prefix. Add a framework here = one line. */
export const FRAMEWORK_PREFIX: Record<string, string> = {
  next:   'NEXT_PUBLIC_',
  vite:   'VITE_',
  astro:  'PUBLIC_',
  // SvelteKit exposes browser env via $env/static/public under PUBLIC_ (default
  // env.publicPrefix). Same prefix as astro but detected separately so a
  // SvelteKit repo (which also carries vite.config) isn't mis-narrowed to VITE_.
  svelte: 'PUBLIC_',
  // Nuxt 3 exposes browser env via runtimeConfig.public, overridable at build
  // time with NUXT_PUBLIC_*. Nuxt bundles vite internally so detect nuxt first.
  nuxt:   'NUXT_PUBLIC_',
  // Gatsby only exposes GATSBY_*-prefixed vars to the browser bundle.
  gatsby: 'GATSBY_',
  // Create React App (react-scripts) only inlines REACT_APP_* into the client.
  cra:    'REACT_APP_',
}

/** All known client prefixes, used to shotgun when the framework is unknown.
 * Deduped: multiple frameworks can share a prefix (astro + svelte both PUBLIC_). */
export const ALL_CLIENT_PREFIXES: string[] = [...new Set(Object.values(FRAMEWORK_PREFIX))]

/**
 * Expand ENV_FLOW base names into the final env var names for a given target.
 * - Non-client target OR non-public base -> raw base name.
 * - Public base on a client target -> prefixed. framework set => single prefix;
 *   framework undefined => shotgun ALL_CLIENT_PREFIXES.
 */
export function resolveEnvKeys(
  baseKeys: string[],
  target: string,
  framework?: string,
): string[] {
  const isClient = CLIENT_FRAMEWORK_TARGETS.has(target)
  const prefixes =
    framework && FRAMEWORK_PREFIX[framework]
      ? [FRAMEWORK_PREFIX[framework]]
      : ALL_CLIENT_PREFIXES
  const out: string[] = []
  for (const base of baseKeys) {
    if (isClient && PUBLIC_ENV_BASES.has(base)) {
      for (const p of prefixes) out.push(p + base)
    } else {
      out.push(base)
    }
  }
  return out
}

/**
 * Pairs that use CF binding instead of env vars.
 * Provisioner will add r2_buckets binding to wrangler.toml (deferred — planned enhancement).
 */
export const BINDING_FLOW: Record<string, Record<string, Array<{ name: string; type: string }>>> = {
  'cloudflare-r2': {
    'cloudflare-workers': [{ name: 'R2_BUCKET', type: 'r2_bucket' }],
  },
}

/**
 * Providers that cannot currently receive env injection via the provision API.
 * Edges targeting these providers will have injection skipped with a warn log.
 * Full support deferred — requires provider Management API.
 */
export const DEFERRED_INJECTION_TARGETS = new Set<string>(['supabase'])

/**
 * Env vars that are write-once secrets: the provider API returns them once at
 * creation time and never again, so they can't be read back for drift comparison.
 * Excluded from computeDesiredEnvKeys' drift-facing output — still injected
 * normally at provision time.
 */
export const WRITE_ONCE_ENV_KEYS = new Set<string>(['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'])
