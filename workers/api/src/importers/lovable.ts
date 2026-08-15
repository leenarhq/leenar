import type { BuilderAdapter, EnvStyle, FetchRepoFile } from "./types";

/** Supabase project refs are 20 lowercase alphanumeric characters. */
const SUPABASE_URL_RE = /https:\/\/([a-z0-9]{20})\.supabase\.co/;

const CLIENT_PATH = "src/integrations/supabase/client.ts";

function refFrom(text: string | null): string | null {
  if (!text) return null;
  const m = SUPABASE_URL_RE.exec(text);
  return m ? m[1] : null;
}

export const lovableAdapter: BuilderAdapter = {
  name: "lovable",

  detect(rootFiles, pkgDeps) {
    let score = 0;
    if (pkgDeps.includes("lovable-tagger")) score += 2;
    if (rootFiles.includes("vite.config.ts") && pkgDeps.includes("vite")) score += 1;
    // A bare Vite config is not evidence of Lovable on its own.
    return score >= 2 ? score : 0;
  },

  async extractBackend(fetchFile: FetchRepoFile) {
    // Lovable commits .env and forbids gitignoring it, so it is the primary
    // source. Older projects hardcode the values in the generated client.
    const [envRaw, clientRaw, configRaw] = await Promise.all([
      fetchFile(".env"),
      fetchFile(CLIENT_PATH, true),
      fetchFile("supabase/config.toml", true),
    ]);

    const envRef = refFrom(envRaw);
    const clientRef = refFrom(clientRaw);

    let envStyle: EnvStyle = "unknown";
    if (envRef) envStyle = "env-file";
    else if (clientRef) envStyle = "hardcoded";

    return {
      supabaseRef: envRef ?? clientRef,
      envStyle,
      hasSupabaseConfig: configRaw !== null,
      framework: "vite" as const,
    };
  },
};
