/** Reads a file from the repo being analysed. Mirrors the fetcher that already
 *  exists inside the /from-repo handler: returns null when the file is absent,
 *  too large, or the request fails. */
export type FetchRepoFile = (
  path: string,
  allowSubdir?: boolean,
) => Promise<string | null>;

/** Where the Supabase URL and key live in the repo. Decides whether injecting
 *  env vars into the host has any effect at all: Vite gives an already-present
 *  process env var priority over a committed .env, but a value hardcoded in a
 *  source file is compiled in and ignores both. */
export type EnvStyle = "env-file" | "hardcoded" | "unknown";

export interface BuilderHint {
  /** Adapter name, e.g. "lovable". */
  builder: string;
  /** Supabase project ref the repo points at, or null when none was readable. */
  supabaseRef: string | null;
  envStyle: EnvStyle;
  /** Repo carries a supabase/config.toml. */
  hasSupabaseConfig: boolean;
  /** Framework the adapter is certain about, so callers need not guess. */
  framework: "vite" | null;
}

export interface BuilderAdapter {
  name: string;
  /** 0 means no match. Higher wins when several adapters match. */
  detect(rootFiles: string[], pkgDeps: string[]): number;
  extractBackend(fetchFile: FetchRepoFile): Promise<Omit<BuilderHint, "builder">>;
}
