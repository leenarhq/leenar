/**
 * Build-time open-core flag. `true` = Leenar Cloud (all features);
 * `false` = self-hosted core (cloud-only panels/nav hidden).
 *
 * Regression-safe default: only an explicit `'false'` turns core-mode on, so
 * the cloud production build (flag unset) is unaffected. The core export writes
 * VITE_LEENAR_CLOUD=false.
 */
export function computeIsCloud(v: string | undefined): boolean {
  return v !== "false";
}

export const isCloud = computeIsCloud(import.meta.env.VITE_LEENAR_CLOUD);
