import type { ProvisioningSession } from "./workflows";

export interface SessionWatcherDeps {
  fetchSession: () => Promise<ProvisioningSession>;
  subscribe: (
    onChange: (s: ProvisioningSession) => void,
    onStatus: (status: "connected" | "dropped") => void,
  ) => () => void;
  onUpdate: (s: ProvisioningSession) => void;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (h: ReturnType<typeof setTimeout>) => void;
  healthyPollMs?: number;
  droppedPollMs?: number;
}

const TERMINAL = new Set(["success", "failed", "cancelled"]);

/**
 * Watch a provisioning session to completion. Resilient by construction: the
 * poll loop independently reaches every terminal status, so a dropped realtime
 * channel can never strand the UI at "deploying forever". Returns a stop()
 * that clears timers and unsubscribes. Pure/DI'd for unit testing.
 */
export function createSessionWatcher(deps: SessionWatcherDeps): () => void {
  const setTimer = deps.setTimer ?? setTimeout;
  const clearTimer = deps.clearTimer ?? clearTimeout;
  const healthyPollMs = deps.healthyPollMs ?? 8000;
  const droppedPollMs = deps.droppedPollMs ?? 2500;

  let done = false;
  let realtimeHealthy = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsub: (() => void) | null = null;

  function stop() {
    if (done) return;
    done = true;
    if (timer) clearTimer(timer);
    timer = null;
    unsub?.();
    unsub = null;
  }

  function handle(ps: ProvisioningSession) {
    if (done) return;
    // Defensive: a malformed/error/null fetch response has no valid string
    // status. Treat it as a non-terminal no-op — don't call onUpdate and
    // don't stop — so the poll safety net simply retries on the next tick
    // instead of silently polling forever with a status that never matches
    // TERMINAL.
    if (!ps || typeof ps.status !== "string") return;
    if (TERMINAL.has(ps.status)) {
      deps.onUpdate(ps);
      stop();
      return;
    }
    deps.onUpdate(ps);
  }

  function scheduleNextPoll() {
    if (done) return;
    const interval = realtimeHealthy ? healthyPollMs : droppedPollMs;
    timer = setTimer(async () => {
      if (done) return;
      try {
        const ps = await deps.fetchSession();
        handle(ps);
      } catch {
        /* transient — next tick retries */
      }
      scheduleNextPoll();
    }, interval);
  }

  // Initial fetch — don't wait for the first realtime event or poll tick.
  void deps
    .fetchSession()
    .then(handle)
    .catch(() => {});

  unsub = deps.subscribe(
    (ps) => handle(ps),
    (status) => {
      realtimeHealthy = status === "connected";
    },
  );

  scheduleNextPoll();

  return stop;
}
