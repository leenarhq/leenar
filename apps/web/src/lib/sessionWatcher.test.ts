import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSessionWatcher } from "./sessionWatcher";
import type { ProvisioningSession } from "./workflows";

const mk = (status: ProvisioningSession["status"]): ProvisioningSession =>
  ({
    id: "s1",
    stack_id: "st1",
    status,
    steps: [],
    current_step: 0,
    total_steps: 1,
    error_message: null,
    finished_at: null,
  }) as ProvisioningSession;

describe("createSessionWatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("catches a terminal state via polling even if realtime never fires", async () => {
    const seq = [mk("running"), mk("running"), mk("success")];
    let i = 0;
    const fetchSession = vi.fn(async () => seq[Math.min(i++, seq.length - 1)]);
    const unsub = vi.fn();
    const onUpdate = vi.fn();
    const stop = createSessionWatcher({
      fetchSession,
      subscribe: () => unsub, // realtime never delivers a message
      onUpdate,
      droppedPollMs: 1000,
      healthyPollMs: 1000,
    });

    // initial fetch (running)
    await vi.advanceTimersByTimeAsync(0);
    // two poll ticks → running, then success
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    const statuses = onUpdate.mock.calls.map((c) => c[0].status);
    expect(statuses).toContain("success");
    expect(unsub).toHaveBeenCalled(); // cleaned up on terminal
    stop();
  });

  it("fires a terminal session only once when realtime and poll race", async () => {
    const onChangeCbHolder: { cb: ((s: ProvisioningSession) => void) | null } =
      { cb: null };
    const fetchSession = vi.fn(async () => mk("success"));
    const onUpdate = vi.fn();
    const stop = createSessionWatcher({
      fetchSession,
      subscribe: (onChange) => {
        onChangeCbHolder.cb = onChange;
        return vi.fn();
      },
      onUpdate,
      healthyPollMs: 1000,
      droppedPollMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(0); // initial fetch → success (terminal)
    onChangeCbHolder.cb?.(mk("success")); // realtime also delivers success afterwards
    await vi.advanceTimersByTimeAsync(2000);
    const terminalCalls = onUpdate.mock.calls.filter(
      (c) => c[0].status === "success",
    );
    expect(terminalCalls.length).toBe(1);
    stop();
  });

  it("switches to the fast poll interval when the channel reports dropped", async () => {
    const statusCbHolder: {
      cb: ((s: "connected" | "dropped") => void) | null;
    } = { cb: null };
    const fetchSession = vi.fn(async () => mk("running"));
    const stop = createSessionWatcher({
      fetchSession,
      subscribe: (_onChange, onStatus) => {
        statusCbHolder.cb = onStatus;
        return vi.fn();
      },
      onUpdate: vi.fn(),
      healthyPollMs: 8000,
      droppedPollMs: 2000,
    });
    await vi.advanceTimersByTimeAsync(0);
    statusCbHolder.cb?.("connected");
    const healthyCount = fetchSession.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000); // < healthy interval, no extra healthy poll
    statusCbHolder.cb?.("dropped");
    await vi.advanceTimersByTimeAsync(2000); // one dropped-interval poll
    expect(fetchSession.mock.calls.length).toBeGreaterThan(healthyCount);
    stop();
  });

  it("stop() clears timers and unsubscribes with no further updates", async () => {
    const fetchSession = vi.fn(async () => mk("running"));
    const unsub = vi.fn();
    const onUpdate = vi.fn();
    const stop = createSessionWatcher({
      fetchSession,
      subscribe: () => unsub,
      onUpdate,
      healthyPollMs: 1000,
      droppedPollMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(0);
    const callsBefore = onUpdate.mock.calls.length;
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(onUpdate.mock.calls.length).toBe(callsBefore);
    expect(unsub).toHaveBeenCalled();
  });
});
