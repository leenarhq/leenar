import { describe, it, expect } from "vitest";
import { buildBriefing } from "./briefing";
import type { BriefingItem } from "./briefing";
import type { DashboardData } from "../hooks/useProjectDashboard";
import type { Incident, StackDrift, NodeUsageData } from "./api";

// ── Minimal helper builders ──────────────────────────────────────────────────

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "inc-1",
    service: "vercel",
    resource_id: "res-1",
    severity: "5xx",
    status_code: 500,
    path: "/api/checkout",
    count: 3,
    first_seen_at: "2024-01-01T08:00:00Z",
    last_seen_at: "2024-01-01T08:30:00Z",
    resolved_at: null,
    status: "open",
    log_snippet: null,
    postmortem: null,
    occurrence_count: null,
    ...overrides,
  };
}

function makeDrift(overrides: Partial<StackDrift> = {}): StackDrift {
  return {
    id: "drift-1",
    node_id: "node-1",
    service: "vercel",
    resource_id: "res-1",
    drift_type: "resource_missing",
    field: "project",
    expected: "exists",
    actual: "missing",
    detected_at: "2024-01-01T09:00:00Z",
    ...overrides,
  };
}

/** Minimal valid DashboardData with everything clean */
const cleanData: DashboardData = {
  summary: null,
  canvas: null,
  deployments: [],
  drifts: [],
  incidents: [],
  usage: {},
  health: [],
  uptime: {},
  cost: null,
  observability: null,
  observabilityHistory: {},
  environments: [],
  activeSession: null,
  loading: false,
  error: null,
  refetch: () => {},
  setDrifts: () => {},
  setIncidents: () => {},
  refetchHealth: async () => {},
  autopilotLevel: "observe" as const,
  autopilotActions: [],
  setAutopilotLevel: () => {},
  setAutopilotActions: () => {},
  refetchAutopilot: async () => {},
};

// ── Scenarios ────────────────────────────────────────────────────────────────

describe("buildBriefing", () => {
  // (a) All clean → single success item
  it("returns a single success item when everything is healthy", () => {
    const result = buildBriefing(cleanData);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("briefing:all-clear");
    expect(result[0].tone).toBe("success");
    expect(result[0].title).toBe("Everything looks healthy");
  });

  // (b) 2 open + 1 acknowledged → only the 2 open incidents count
  it("counts only open incidents (not acknowledged)", () => {
    const incidents: Incident[] = [
      makeIncident({ id: "inc-1", status: "open" }),
      makeIncident({ id: "inc-2", status: "open" }),
      makeIncident({ id: "inc-3", status: "acknowledged" }),
    ];
    const result = buildBriefing({ ...cleanData, incidents });
    const incItem = result.find(
      (i: BriefingItem) => i.id === "briefing:incidents",
    );
    expect(incItem).toBeDefined();
    expect(incItem!.tone).toBe("error");
    expect(incItem!.title).toBe("2 open incidents");
    expect(incItem!.anchor).toBe("incidents");
    // all-clear should NOT appear
    expect(result.find((i) => i.id === "briefing:all-clear")).toBeUndefined();
  });

  // (c) Drift present → warning item with anchor "drifts"
  it("produces a warning item when drifts are present", () => {
    const result = buildBriefing({ ...cleanData, drifts: [makeDrift()] });
    const driftItem = result.find(
      (i: BriefingItem) => i.id === "briefing:drifts",
    );
    expect(driftItem).toBeDefined();
    expect(driftItem!.tone).toBe("warning");
    expect(driftItem!.anchor).toBe("drifts");
    expect(result.find((i) => i.id === "briefing:all-clear")).toBeUndefined();
  });

  // (d) DB at 85% → usage warning item
  it("produces a usage warning when db_size is at 85% of limit", () => {
    const DB_LIMIT = 500 * 1024 * 1024;
    const usage: Record<string, NodeUsageData> = {
      "node-abc": { db_size: Math.round(DB_LIMIT * 0.85) },
    };
    const result = buildBriefing({ ...cleanData, usage });
    const usageItem = result.find((i: BriefingItem) =>
      i.id.startsWith("briefing:usage:db:"),
    );
    expect(usageItem).toBeDefined();
    expect(usageItem!.tone).toBe("warning");
    expect(usageItem!.anchor).toBe("usage");
    expect(usageItem!.title).toContain("85%");
  });

  // (e) Last deploy failed → error item with anchor "deployments"
  it("produces an error item when last_deploy_status is failed", () => {
    const summary = {
      id: "proj-1",
      user_id: "user-1",
      name: "Test Project",
      status: "active" as const,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
      node_count: 2,
      edge_count: 1,
      deploy_count: 5,
      last_deployed_at: "2024-01-01T10:00:00Z",
      last_deploy_status: "failed" as const,
      last_deployment_id: "dep-99",
    };
    const result = buildBriefing({ ...cleanData, summary });
    const failItem = result.find(
      (i: BriefingItem) => i.id === "briefing:deploy:failed",
    );
    expect(failItem).toBeDefined();
    expect(failItem!.tone).toBe("error");
    expect(failItem!.anchor).toBe("deployments");
    expect(result.find((i) => i.id === "briefing:all-clear")).toBeUndefined();
  });
});
