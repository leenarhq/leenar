import { describe, it, expect } from "vitest";
import { computeHealthScore, healthLabel } from "./healthScore";
import type { Incident, StackDrift, NodeUsageData } from "./api";
import type { ProjectSummary } from "./workflows";

const emptyData = () => ({
  incidents: [] as Incident[],
  drifts: [] as StackDrift[],
  health: [] as Array<{ nodeId: string; alive: boolean }>,
  summary: null as ProjectSummary | null,
  usage: {} as Record<string, NodeUsageData>,
});

const makeIncident = (
  severity: Incident["severity"],
  status: Incident["status"] = "open",
): Incident => ({
  id: Math.random().toString(),
  service: "vercel",
  resource_id: "res1",
  severity,
  status_code: severity === "5xx" ? 500 : null,
  path: null,
  count: 1,
  first_seen_at: new Date().toISOString(),
  last_seen_at: new Date().toISOString(),
  resolved_at: null,
  status,
  log_snippet: null,
  postmortem: null,
  occurrence_count: null,
});

const makeDrift = (drift_type: StackDrift["drift_type"]): StackDrift => ({
  id: Math.random().toString(),
  node_id: "node1",
  service: "vercel",
  resource_id: "res1",
  drift_type,
  field: "field",
  expected: "expected",
  actual: "actual",
  detected_at: new Date().toISOString(),
});

describe("computeHealthScore", () => {
  it("returns 100 for empty data", () => {
    expect(computeHealthScore(emptyData())).toBe(100);
  });

  it("deducts 20 for 5xx incident", () => {
    const data = emptyData();
    data.incidents = [makeIncident("5xx")];
    expect(computeHealthScore(data)).toBe(80);
  });

  it("caps 5xx at -40 (2+ incidents)", () => {
    const data = emptyData();
    data.incidents = [
      makeIncident("5xx"),
      makeIncident("5xx"),
      makeIncident("5xx"),
    ];
    expect(computeHealthScore(data)).toBe(60);
  });

  it("deducts 10 for error incident", () => {
    const data = emptyData();
    data.incidents = [makeIncident("error")];
    expect(computeHealthScore(data)).toBe(90);
  });

  it("deducts 25 for resource_missing drift", () => {
    const data = emptyData();
    data.drifts = [makeDrift("resource_missing")];
    expect(computeHealthScore(data)).toBe(75);
  });

  it("caps resource_missing at -50", () => {
    const data = emptyData();
    data.drifts = [
      makeDrift("resource_missing"),
      makeDrift("resource_missing"),
      makeDrift("resource_missing"),
    ];
    expect(computeHealthScore(data)).toBe(50);
  });

  it("deducts 15 for failed last deploy", () => {
    const data = emptyData();
    data.summary = {
      id: "proj1",
      user_id: "user1",
      name: "Test",
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      node_count: 1,
      edge_count: 0,
      deploy_count: 1,
      last_deployed_at: new Date().toISOString(),
      last_deploy_status: "failed",
      last_deployment_id: "dep1",
    } as ProjectSummary;
    expect(computeHealthScore(data)).toBe(85);
  });

  it("deducts 15 for dead node", () => {
    const data = emptyData();
    data.health = [{ nodeId: "node1", alive: false }];
    expect(computeHealthScore(data)).toBe(85);
  });

  it("caps dead nodes at -30", () => {
    const data = emptyData();
    data.health = [
      { nodeId: "node1", alive: false },
      { nodeId: "node2", alive: false },
      { nodeId: "node3", alive: false },
    ];
    expect(computeHealthScore(data)).toBe(70);
  });

  it("floors at 0", () => {
    const data = emptyData();
    // 5xx cap: -40, error cap: -20, resource_missing cap: -50, dead nodes cap: -30 → total -140
    data.incidents = [
      makeIncident("5xx"),
      makeIncident("5xx"),
      makeIncident("5xx"),
      makeIncident("error"),
      makeIncident("error"),
      makeIncident("error"),
    ];
    data.drifts = [
      makeDrift("resource_missing"),
      makeDrift("resource_missing"),
      makeDrift("resource_missing"),
    ];
    data.health = [
      { nodeId: "node1", alive: false },
      { nodeId: "node2", alive: false },
      { nodeId: "node3", alive: false },
    ];
    expect(computeHealthScore(data)).toBe(0);
  });

  it("ignores resolved incidents", () => {
    const data = emptyData();
    data.incidents = [
      makeIncident("5xx", "resolved"),
      makeIncident("error", "acknowledged"),
    ];
    expect(computeHealthScore(data)).toBe(100);
  });

  it("deducts 5 for db_size >= 80% of 500MB", () => {
    const data = emptyData();
    data.usage = { node1: { db_size: Math.ceil(500 * 1024 * 1024 * 0.8) } };
    expect(computeHealthScore(data)).toBe(95);
  });

  it("deducts 5 for MAU >= 400", () => {
    const data = emptyData();
    data.usage = { node1: { mau: 400 } };
    expect(computeHealthScore(data)).toBe(95);
  });

  it("does not deduct for db_size below threshold", () => {
    const data = emptyData();
    data.usage = { node1: { db_size: Math.floor(500 * 1024 * 1024 * 0.79) } };
    expect(computeHealthScore(data)).toBe(100);
  });

  it("does not deduct for MAU below threshold", () => {
    const data = emptyData();
    data.usage = { node1: { mau: 399 } };
    expect(computeHealthScore(data)).toBe(100);
  });
});

describe("healthLabel", () => {
  it("is ok at 80 and above", () => {
    expect(healthLabel(80)).toEqual({ label: "Healthy", tone: "ok" });
    expect(healthLabel(100)).toEqual({ label: "Healthy", tone: "ok" });
  });

  it("is warn between 50 and 79", () => {
    expect(healthLabel(65)).toEqual({ label: "Warning", tone: "warn" });
  });

  it("is crit below 50", () => {
    expect(healthLabel(30)).toEqual({ label: "Critical", tone: "crit" });
  });
});
