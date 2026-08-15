import type { BuilderAdapter, BuilderHint, FetchRepoFile } from "./types";
import { lovableAdapter } from "./lovable";

export type { BuilderHint, FetchRepoFile, EnvStyle } from "./types";

const ADAPTERS: BuilderAdapter[] = [lovableAdapter];

/**
 * Pick the highest-scoring adapter and let it read the repo's backend.
 * Returns null when nothing matches — callers must treat that as "carry on
 * exactly as before", never as an error.
 */
export async function detectBuilder(
  rootFiles: string[],
  pkgDeps: string[],
  fetchFile: FetchRepoFile,
): Promise<BuilderHint | null> {
  let best: BuilderAdapter | null = null;
  let bestScore = 0;
  for (const adapter of ADAPTERS) {
    const score = adapter.detect(rootFiles, pkgDeps);
    if (score > bestScore) {
      best = adapter;
      bestScore = score;
    }
  }
  if (!best) return null;

  try {
    const backend = await best.extractBackend(fetchFile);
    return { builder: best.name, ...backend };
  } catch {
    // A failed read must not break the import flow.
    return null;
  }
}
