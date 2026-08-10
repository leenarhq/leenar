import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildRevertResult, executeRollback } from "./rollbackExecution";

const ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  VERCEL_TOKEN: "",
} as any;

// ── buildRevertResult ────────────────────────────────────────────────────────

describe("buildRevertResult", () => {
  it("returns not_supported for supabase", async () => {
    const r = await buildRevertResult("n1", { service: "supabase" }, { env: ENV, userId: "u1" });
    expect(r.action).toBe("not_supported");
    expect(r.nodeId).toBe("n1");
  });

  it("returns not_supported for github", async () => {
    const r = await buildRevertResult("n2", { service: "github" }, { env: ENV, userId: "u1" });
    expect(r.action).toBe("not_supported");
  });

  it("returns not_supported for cloudflare-r2", async () => {
    const r = await buildRevertResult("n3", { service: "cloudflare-r2" }, { env: ENV, userId: "u1" });
    expect(r.action).toBe("not_supported");
  });

  it("returns canvas_only for unknown service", async () => {
    const r = await buildRevertResult("n4", { service: "resend" }, { env: ENV, userId: "u1" });
    expect(r.action).toBe("canvas_only");
  });

  it("returns canvas_only for vercel ref missing deploymentId", async () => {
    // service=vercel but no deploymentId → falls through to canvas_only
    const r = await buildRevertResult("n5", { service: "vercel", projectId: "p1" }, { env: ENV, userId: "u1" });
    expect(r.action).toBe("canvas_only");
  });
});

// ── executeRollback ───────────────────────────────────────────────────────────

describe("executeRollback", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function sbResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status });
  }

  it("returns not_found when deployment row missing", async () => {
    fetchMock.mockResolvedValue(sbResponse([])); // empty → not found
    const r = await executeRollback(ENV, "proj-1", "dep-1", "user-1");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("not_found");
  });

  it("returns not_found when deployment sb() fetch itself fails (non-ok)", async () => {
    fetchMock.mockResolvedValue(new Response("error", { status: 500 }));
    const r = await executeRollback(ENV, "proj-1", "dep-1", "user-1");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("not_found");
  });

  it("warns and sets canvasRestored=false when canvas_snapshot is empty", async () => {
    let callCount = 0;
    fetchMock.mockImplementation(async (url: string) => {
      callCount++;
      if (url.includes("project_deployments") && callCount === 1) {
        return sbResponse([{
          canvas_snapshot: { nodes: [] }, // empty
          provider_refs: {},
          env_node_state_snapshot: {},
          environment_id: "env-1",
        }]);
      }
      return sbResponse({}, 200); // lock + status patch succeed
    });

    const r = await executeRollback(ENV, "proj-1", "dep-1", "user-1");
    expect(r.canvasRestored).toBe(false);
    expect(r.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("canvas_snapshot empty"),
    ]));
  });

  it("returns results=[] and ok=true when provider_refs empty (Supabase-only)", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("project_deployments") && url.includes("select=")) {
        return sbResponse([{
          canvas_snapshot: { nodes: [{ id: "n1", data: {} }] },
          provider_refs: {},
          env_node_state_snapshot: {},
          environment_id: null,
        }]);
      }
      return sbResponse({}, 200);
    });

    const r = await executeRollback(ENV, "proj-1", "dep-1", "user-1");
    expect(r.results).toHaveLength(0);
  });
});
