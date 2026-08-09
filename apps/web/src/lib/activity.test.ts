import { describe, it, expect } from "vitest";
import { buildActivityFeed } from "./activity";
import type { ActivityItem } from "./activity";
import type { StackDrift, Incident, WorkflowEnvironment } from "./api";

// Helpers to build minimal test data
function makeDeploy(
  overrides: Partial<{
    id: string;
    status: string;
    queued_at: string;
    finished_at: string | null;
  }> = {},
) {
  return {
    id: "dep-1",
    status: "success",
    queued_at: "2024-01-01T10:00:00Z",
    finished_at: "2024-01-01T10:05:00Z",
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

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "inc-1",
    service: "vercel",
    resource_id: "res-1",
    severity: "5xx",
    status_code: 500,
    path: "/api/data",
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

function makeEnv(
  overrides: Partial<WorkflowEnvironment> = {},
): WorkflowEnvironment {
  return {
    id: "env-1",
    workflow_id: "wf-1",
    name: "production",
    slug: "production",
    is_default: true,
    display_order: 0,
    created_at: "2024-01-01T07:00:00Z",
    ...overrides,
  };
}

const empty = {
  deployments: [],
  drifts: [],
  incidents: [],
  environments: [],
};

describe("buildActivityFeed", () => {
  // Test 1: Empty input
  it("returns [] when all inputs are empty", () => {
    const result = buildActivityFeed(empty);
    expect(result).toEqual([]);
  });

  // Test 2: Single deployment with finished_at (success)
  it("maps a succeeded deployment correctly", () => {
    const result = buildActivityFeed({
      ...empty,
      deployments: [
        makeDeploy({ status: "success", finished_at: "2024-01-01T10:05:00Z" }),
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Deployment succeeded");
    expect(result[0].tone).toBe("success");
    expect(result[0].kind).toBe("deploy");
  });

  // Test 3: Single deployment WITHOUT finished_at
  it("maps a queued deployment correctly", () => {
    const result = buildActivityFeed({
      ...empty,
      deployments: [makeDeploy({ finished_at: null, status: "queued" })],
    });
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Deployment queued");
    expect(result[0].tone).toBe("neutral");
  });

  // Test 4: Mixed timestamps from all 4 sources → sorted descending by ts
  it("sorts items by ts descending across all sources", () => {
    const result = buildActivityFeed({
      deployments: [makeDeploy({ finished_at: "2024-01-01T10:00:00Z" })],
      drifts: [makeDrift({ detected_at: "2024-01-01T12:00:00Z" })],
      incidents: [makeIncident({ first_seen_at: "2024-01-01T11:00:00Z" })],
      environments: [makeEnv({ created_at: "2024-01-01T09:00:00Z" })],
    });
    // drift (12:00) > incident (11:00) > deploy (10:00) > env (09:00)
    expect(result[0].kind).toBe("drift");
    expect(result[1].kind).toBe("incident");
    expect(result[2].kind).toBe("deploy");
    expect(result[3].kind).toBe("environment");
  });

  // Test 5: More than 10 items total → exactly 10 returned
  it("returns exactly 10 items when there are more than 10", () => {
    const deployments = Array.from({ length: 12 }, (_, i) =>
      makeDeploy({
        id: `dep-${i}`,
        finished_at: `2024-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      }),
    );
    const result = buildActivityFeed({ ...empty, deployments });
    expect(result).toHaveLength(10);
  });

  // Test 6: Incident WITH resolved_at → TWO items
  it("produces two items for a resolved incident", () => {
    const result = buildActivityFeed({
      ...empty,
      incidents: [
        makeIncident({
          resolved_at: "2024-01-01T09:00:00Z",
          first_seen_at: "2024-01-01T08:00:00Z",
        }),
      ],
    });
    expect(result).toHaveLength(2);
    const ids = result.map((i: ActivityItem) => i.id);
    expect(ids).toContain("incident:inc-1:open");
    expect(ids).toContain("incident:inc-1:resolved");
  });

  // Test 7: Incident WITHOUT resolved_at → ONE item
  it("produces one item for an unresolved incident", () => {
    const result = buildActivityFeed({
      ...empty,
      incidents: [makeIncident({ resolved_at: null })],
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("incident:inc-1:open");
  });

  it("cancelled deployment produces label 'Deployment cancelled' with tone neutral", () => {
    const result = buildActivityFeed({
      deployments: [
        {
          id: "d1",
          status: "cancelled",
          queued_at: "2024-01-01T10:00:00Z",
          finished_at: "2024-01-01T11:00:00Z",
        },
      ],
      drifts: [],
      incidents: [],
      environments: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Deployment cancelled");
    expect(result[0].tone).toBe("neutral");
  });
});
