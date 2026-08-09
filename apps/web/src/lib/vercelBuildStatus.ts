export type BuildUi = "building" | "ready" | "error" | "unknown";

export const VERCEL_BUILD_POLL_MS = 4000;
export const VERCEL_BUILD_MAX_ATTEMPTS = 75; // ~5 min at 4s cadence

export function mapReadyState(readyState: string): BuildUi {
  switch (readyState) {
    case "READY":
      return "ready";
    case "ERROR":
    case "CANCELED":
      return "error";
    case "QUEUED":
    case "INITIALIZING":
    case "BUILDING":
      return "building";
    default:
      return "unknown";
  }
}

export function isPollDone(ui: BuildUi): boolean {
  return ui === "ready" || ui === "error";
}
