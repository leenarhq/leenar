// AUTO-GENERATED — do not edit manually.
// Run `npm run sync-env-flow` from repo root to regenerate.
// Source of truth: workers/api/src/constants/envFlow.ts
export const ENV_FLOW: Record<string, Record<string, string[]>> = {
  supabase: {
    vercel: ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
    "cloudflare-workers": [
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ],
  },
  github: {
    vercel: ["GITHUB_OWNER", "GITHUB_REPO"],
    "cloudflare-workers": ["GITHUB_REPO_URL", "GITHUB_OWNER", "GITHUB_REPO"],
  },
  resend: {
    "cloudflare-workers": ["RESEND_API_KEY"],
    vercel: ["RESEND_API_KEY"],
  },
  "cloudflare-workers": {
    vercel: ["API_URL", "WORKER_URL"],
  },
  vercel: {
    "cloudflare-workers": ["ALLOWED_ORIGIN", "FRONTEND_URL"],
  },
  "cloudflare-r2": {
    vercel: [
      "R2_BUCKET_NAME",
      "R2_ENDPOINT",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
    ],
  },
};

export const PUBLIC_ENV_BASES = new Set<string>([
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "API_URL",
  "WORKER_URL",
]);

export const CLIENT_FRAMEWORK_TARGETS = new Set<string>(["vercel"]);

export const FRAMEWORK_PREFIX: Record<string, string> = {
  next: "NEXT_PUBLIC_",
  vite: "VITE_",
  astro: "PUBLIC_",
  svelte: "PUBLIC_",
  nuxt: "NUXT_PUBLIC_",
  gatsby: "GATSBY_",
  cra: "REACT_APP_",
};

export const ALL_CLIENT_PREFIXES: string[] = [
  ...new Set(Object.values(FRAMEWORK_PREFIX)),
];

/**
 * Expand ENV_FLOW base names into the final env var names for a given target.
 * Mirror of resolveEnvKeys in workers/api/src/constants/envFlow.ts.
 */
export function resolveEnvKeys(
  baseKeys: string[],
  target: string,
  framework?: string,
): string[] {
  const isClient = CLIENT_FRAMEWORK_TARGETS.has(target);
  const prefixes =
    framework && FRAMEWORK_PREFIX[framework]
      ? [FRAMEWORK_PREFIX[framework]]
      : ALL_CLIENT_PREFIXES;
  const out: string[] = [];
  for (const base of baseKeys) {
    if (isClient && PUBLIC_ENV_BASES.has(base)) {
      for (const p of prefixes) out.push(p + base);
    } else {
      out.push(base);
    }
  }
  return out;
}
