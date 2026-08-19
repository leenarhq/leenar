/**
 * Everything about reading a GitHub repo's surface — which files are in the
 * root, what they declare, and what that implies about the services it needs.
 *
 * This lives outside routes/ because two callers need it and they must agree:
 * analyzeRepo (routes/workflowProvision.ts), which runs once per import, and
 * summarizeRepo below, which runs once per grid cell. If the two counted env
 * keys differently the grid would say "12 env keys" and the proposal card one
 * click later would say "14".
 */

/** Env files, in the order analyzeRepo has always preferred them: an example
 *  file first, because it is the one written to be read. */
export const ENV_FILE_CANDIDATES = [
  ".env.example",
  ".env.sample",
  ".env.local.example",
  ".env",
];

/** Config files worth scanning for `process.env.X`. Framework configs only —
 *  they are small, they are in the root, and they are where the keys a repo
 *  actually reads at build time are named. */
export const CONFIG_CANDIDATES = [
  "next.config.mjs",
  "next.config.ts",
  "next.config.js",
  "vite.config.ts",
  "vite.config.js",
];

export function pickEnvFile(rootFiles: string[]): string | null {
  const set = new Set(rootFiles);
  return ENV_FILE_CANDIDATES.find((f) => set.has(f)) ?? null;
}

/** Env keys declared by a .env-style file. Comments and blank lines are
 *  skipped; the 200-line ceiling is a DoS guard, not a format assumption. */
export function parseEnvKeys(raw: string): string[] {
  return raw
    .split("\n")
    .slice(0, 200)
    .map((l) => l.replace(/#.*$/, "").split("=")[0].trim())
    .filter((k) => /^[A-Z_][A-Z0-9_]{0,63}$/.test(k));
}

const SOURCE_ENV_RE =
  /(?:process\.env|import\.meta\.env)\.([A-Z_][A-Z0-9_]{0,63})/g;

/** Env keys a config file reads. Nulls are accepted so callers can pass the
 *  result of a Promise.all over files that may not exist. */
export function parseSourceEnvKeys(contents: Array<string | null>): string[] {
  const out = new Set<string>();
  for (const content of contents) {
    if (!content) continue;
    const re = new RegExp(SOURCE_ENV_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) out.add(m[1]);
  }
  return [...out];
}

export type RepoSvcType = "github" | "vercel" | "supabase" | "resend";

export interface DetectedServices {
  services: RepoSvcType[];
  connections: Array<{ from_type: RepoSvcType; to_type: RepoSvcType }>;
}

export function detectServicesFromDeps(
  deps: string[],
  envKeys: string[] = [],
  rootFiles: string[] = [],
): DetectedServices {
  const SUPABASE_ENV_RE = /^(NEXT_PUBLIC_|VITE_)?SUPABASE_/;
  const RESEND_ENV_RE = /^RESEND_/;

  // Vercel: explicit signal required — vercel.json in root OR @vercel/* package
  // (generic frameworks like express/next are NOT Vercel-specific)
  const hasVercel =
    rootFiles.includes("vercel.json") ||
    deps.some((d) => d === "@vercel/node" || d.startsWith("@vercel/")) ||
    envKeys.some((k) => k === "VERCEL_URL" || k === "VERCEL_TOKEN") ||
    // Next.js + Supabase combos are almost always Vercel-hosted
    (deps.includes("next") &&
      deps.some((d) =>
        [
          "@supabase/supabase-js",
          "@supabase/ssr",
          "@supabase/auth-helpers-nextjs",
        ].includes(d),
      ));

  // Fallback: if there's a deployable frontend framework but no other host signal,
  // assume Vercel (most common default).
  // Vite is included because it's almost exclusively used for frontend SPAs.
  const hasFrontendFramework = deps.some((d) =>
    [
      "next",
      "nuxt",
      "@remix-run/react",
      "react-scripts",
      "gatsby",
      "@sveltejs/kit",
      "astro",
      "vite",
    ].includes(d),
  );

  const hasSupabase =
    deps.some((d) =>
      [
        "@supabase/supabase-js",
        "@supabase/ssr",
        "@supabase/auth-helpers-nextjs",
      ].includes(d),
    ) || envKeys.some((k) => SUPABASE_ENV_RE.test(k));

  const hasResend =
    deps.some((d) => ["resend", "@resend/node"].includes(d)) ||
    envKeys.some((k) => RESEND_ENV_RE.test(k));

  // Use Vercel only if explicitly signaled OR if there's a frontend framework with no other host
  const useVercel = hasVercel || hasFrontendFramework;

  const services: RepoSvcType[] = ["github"];
  if (hasSupabase) services.push("supabase");
  if (useVercel) services.push("vercel");
  if (hasResend) services.push("resend");

  const connections: Array<{ from_type: RepoSvcType; to_type: RepoSvcType }> =
    [];
  if (hasSupabase && useVercel)
    connections.push({ from_type: "supabase", to_type: "vercel" });
  if (useVercel) connections.push({ from_type: "github", to_type: "vercel" });
  if (hasResend && useVercel)
    connections.push({ from_type: "resend", to_type: "vercel" });
  else if (hasResend && hasSupabase)
    connections.push({ from_type: "resend", to_type: "supabase" });

  return { services, connections };
}

/**
 * "Is there an application here at all?" — the question the dimmed grid cell
 * asks. Deliberately wider than package.json: only package.json produces the
 * service chips, but a Python or Go repo still has an app, and dimming it to
 * 50% and refusing the click would take away a path that works today.
 */
const APP_MANIFESTS = [
  "package.json",
  "requirements.txt",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "Gemfile",
  "composer.json",
  "Dockerfile",
  "index.html",
];

export function hasAppManifest(rootFiles: string[]): boolean {
  const set = new Set(rootFiles);
  return APP_MANIFESTS.some((f) => set.has(f));
}

/** Root files that only exist to declare a workspace. */
const WORKSPACE_MANIFESTS = [
  "pnpm-workspace.yaml",
  "pnpm-workspace.yml",
  "lerna.json",
  "nx.json",
  "turbo.json",
  "rush.json",
];

/**
 * "Are the apps one level down?" — answered from the root listing and the
 * package.json this scan already has, so it costs nothing.
 *
 * It exists because of what summarizeRepo deliberately does not do. The
 * five-path workspace probe that analyzeRepo runs would be 200 extra fetches
 * across a full grid, so a monorepo root comes back with no service chips at
 * all — and an empty chip row reads as "we looked and found nothing", which
 * is the opposite of true. This is the cheap half of that answer: not which
 * services are in there, but that there is an in-there.
 *
 * `workspaces` covers npm, yarn and bun, in both the array and the
 * `{ packages: [...] }` form. Cargo and Go put their workspace declaration
 * inside a file this scan does not read, so a Rust or Go monorepo is a known
 * miss — undetected, not misreported.
 */
export function detectMonorepo(
  rootFiles: string[],
  pkg: Record<string, unknown> | null,
): boolean {
  const set = new Set(rootFiles);
  if (WORKSPACE_MANIFESTS.some((f) => set.has(f))) return true;

  const ws = pkg?.workspaces;
  if (Array.isArray(ws)) return ws.length > 0;
  if (ws && typeof ws === "object") {
    const packages = (ws as { packages?: unknown }).packages;
    return Array.isArray(packages) && packages.length > 0;
  }
  return false;
}

/** One grid cell's worth of scan. `envKeys` is a COUNT, never the names: the
 *  cell only ever renders the number, and the names are the sensitive half. */
export interface RepoSummary {
  full_name: string;
  hasApp: boolean;
  envKeys: number;
  services: RepoSvcType[];
  isMonorepo: boolean;
}

interface GhContentItem {
  name: string;
  type: string;
  download_url: string | null;
}

/**
 * GitHub's contents listing hands back a `download_url` per file, already
 * pointed at the default branch and, for a private repo, already signed.
 * Reading bodies through it costs nothing against the 5,000/hour API budget —
 * raw.githubusercontent.com is a different host with its own limits — which is
 * what makes a forty-cell grid affordable at one API call per repo. analyzeRepo
 * pays for a repo-info request to learn the branch; here the listing already
 * said.
 *
 * The host check is not decoration. This URL came off the wire, and the line
 * below can attach the user's token to it.
 */
async function fetchRawFile(
  url: string | null,
  token: string | null,
): Promise<string | null> {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "raw.githubusercontent.com") return null;

  const headers: Record<string, string> = { "User-Agent": "Leenar/1.0" };
  // A signed download_url already carries its own credential; a second one in
  // the Authorization header is what GitHub rejects.
  if (token && !parsed.searchParams.has("token"))
    headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!res || !res.ok) return null;

  const blob = await res.blob();
  if (blob.size > 128 * 1024) return null;
  return blob.text();
}

/**
 * Returns null — rather than an empty summary — for any repo GitHub will not
 * answer for. The caller drops it from the response and the cell renders
 * plain. A transient 502 greying out a working repo and refusing the click is
 * the worst thing this feature could do, and the null makes it unrepresentable.
 *
 * Deliberately NOT done here, unlike analyzeRepo: the five-path monorepo
 * workspace probe (routes/workflowProvision.ts). A full grid would pay 500
 * extra fetches for it. A monorepo root therefore still shows no service
 * chips, stays clickable, and is corrected by the proposal card one click
 * later — but `isMonorepo` now says so out loud, so the empty chip row is
 * labelled rather than left to read as "we looked and found nothing".
 */
export async function summarizeRepo(
  fullName: string,
  token: string | null,
): Promise<RepoSummary | null> {
  const headers: Record<string, string> = {
    "User-Agent": "Leenar/1.0",
    Accept: "application/vnd.github.v3+json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(
    `https://api.github.com/repos/${fullName}/contents/`,
    {
      headers,
      signal: AbortSignal.timeout(8_000),
    },
  ).catch(() => null);
  if (!res || !res.ok) return null;

  const items = (await res.json().catch(() => null)) as GhContentItem[] | null;
  if (!Array.isArray(items)) return null;

  const files = items.filter((f) => f && f.type === "file");
  const rootFiles = files.map((f) => f.name);
  const urlOf = (name: string) =>
    files.find((f) => f.name === name)?.download_url ?? null;

  const envFile = pickEnvFile(rootFiles);
  const configFiles = CONFIG_CANDIDATES.filter((f) => rootFiles.includes(f));

  const [pkgRaw, envRaw, ...configRaws] = await Promise.all([
    fetchRawFile(urlOf("package.json"), token),
    envFile ? fetchRawFile(urlOf(envFile), token) : Promise.resolve(null),
    ...configFiles.map((f) => fetchRawFile(urlOf(f), token)),
  ]);

  let deps: string[] = [];
  let pkg: Record<string, unknown> | null = null;
  if (pkgRaw) {
    try {
      pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
      deps = Object.keys({
        ...((pkg.dependencies as Record<string, unknown>) ?? {}),
        ...((pkg.devDependencies as Record<string, unknown>) ?? {}),
      }).slice(0, 500);
    } catch {
      /* malformed package.json — read as no dependencies, same as analyzeRepo */
    }
  }

  // Same two sources analyzeRepo uses, through the same two parsers, so the
  // count on the cell equals the count on the proposal card.
  const envKeys = new Set([
    ...(envRaw ? parseEnvKeys(envRaw) : []),
    ...parseSourceEnvKeys(configRaws),
  ]);

  return {
    full_name: fullName,
    hasApp: hasAppManifest(rootFiles),
    envKeys: envKeys.size,
    services: detectServicesFromDeps(deps, [...envKeys], rootFiles).services,
    isMonorepo: detectMonorepo(rootFiles, pkg),
  };
}
