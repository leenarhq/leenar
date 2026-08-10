/**
 * Task 13 (E2·T13) — automated cross-tenant isolation test.
 *
 * Stand-in for the plan's manual two-account probe: proves a caller
 * authenticated as user A cannot read user B's data through the tenancy
 * layer, across multiple resource types and both the data-function and
 * route (HTTP) levels.
 *
 * Fixtures always give B the resource and give A nothing matching — so if a
 * future change ever drops a `user_id`/ownership filter, the missing filter
 * would leak B's row to A and these tests would fail.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { Env } from "./types";
import { scopedQuery, scopedByProject, NotOwnedError } from "./tenancy";
import {
  listEnvironmentsData,
  getEnvironmentSecretsData,
  environmentsRouter,
} from "./routes/environments";
import { getLogsData } from "./routes/logs";

vi.mock("./routes/apiKeys", () => ({
  verifyApiKey: vi.fn(),
}));

import { createApp } from "./appSetup";
import { verifyApiKey } from "./routes/apiKeys";

const ENV = {
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "svc",
} as Env;

const USER_A = "aaaaaaaa-0000-0000-0000-00000000000a"; // attacker / has nothing
const USER_B = "bbbbbbbb-0000-0000-0000-00000000000b"; // victim / owns everything below
const PROJECT_B = "cccccccc-0000-0000-0000-0000000000c1";
const ENV_B = "dddddddd-0000-0000-0000-0000000000d1";

type Row = Record<string, unknown>;

/**
 * Minimal PostgREST-shaped fetch stub: filters fixture rows by every
 * `eq.` query param (ignores select/order/limit as filters, but still
 * respects `limit`). Table name is taken from the request path. This lets
 * each test assert on REAL filtering behavior (does the emitted URL/filter
 * actually exclude B's row when queried as A) rather than a hand-rolled
 * canned response.
 */
function makePostgrestFetch(fixtures: Record<string, Row[]>) {
  const fn = vi.fn(async (url: string | URL) => {
    const u = new URL(String(url));
    const table = u.pathname.replace(/^\/rest\/v1\//, "");
    let rows = fixtures[table] ?? [];
    for (const [key, val] of u.searchParams.entries()) {
      if (key === "select" || key === "order" || key === "limit") continue;
      const m = /^eq\.(.*)$/.exec(val);
      if (m) rows = rows.filter((r) => String(r[key]) === m[1]);
    }
    const limit = u.searchParams.get("limit");
    if (limit) rows = rows.slice(0, Number(limit));
    return new Response(JSON.stringify(rows), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("cross-tenant isolation: data-function level", () => {
  it("listEnvironmentsData: A cannot list B's project's environments (404, not B's rows)", async () => {
    makePostgrestFetch({
      projects: [{ id: PROJECT_B, user_id: USER_B }],
      project_environments: [
        { id: ENV_B, project_id: PROJECT_B, name: "prod", slug: "prod", is_default: true, display_order: 0 },
      ],
    });
    const result = await listEnvironmentsData(PROJECT_B, USER_A, ENV);
    expect(result).toEqual({ error: "Not found", status: 404 });
  });

  it("getEnvironmentSecretsData: A cannot read B's environment's secret keys (404, not B's rows)", async () => {
    makePostgrestFetch({
      projects: [{ id: PROJECT_B, user_id: USER_B }],
      project_environments: [
        { id: ENV_B, project_id: PROJECT_B, name: "prod", slug: "prod", is_default: true, display_order: 0 },
      ],
      project_env_secret_overrides: [
        { node_id: "n1", environment_id: ENV_B, env_var_key: "SECRET_KEY", updated_at: "2026-01-01" },
      ],
    });
    const result = await getEnvironmentSecretsData(ENV_B, USER_A, ENV);
    expect(result).toEqual({ error: "Not found", status: 404 });
  });

  it("getLogsData: A gets 'Project not found' for B's project, never B's logs", async () => {
    makePostgrestFetch({
      projects: [{ id: PROJECT_B, user_id: USER_B, canvas: null }],
    });
    await expect(getLogsData(PROJECT_B, USER_A, ENV)).rejects.toThrow("Project not found");
  });

  it("scopedByProject: rejects with NotOwnedError for B's project and NEVER queries the child table (metrics_snapshots)", async () => {
    const f = makePostgrestFetch({
      projects: [{ id: PROJECT_B, user_id: USER_B }],
    });
    await expect(
      scopedByProject(ENV, USER_A, PROJECT_B, "metrics_snapshots", { query: "select=cpu" }),
    ).rejects.toBeInstanceOf(NotOwnedError);

    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/metrics_snapshots"))).toBe(false);
    expect(urls.length).toBe(1); // only the ownership check fired
  });

  it("scopedQuery: emits user_id=eq.<A> on 'projects' so B's row can never match A's filter", async () => {
    const f = makePostgrestFetch({
      projects: [{ id: PROJECT_B, user_id: USER_B }],
    });
    const res = await scopedQuery(ENV, USER_A, "projects", { query: `id=eq.${PROJECT_B}` });
    const url = String(f.mock.calls[0][0]);
    expect(url).toContain(`user_id=eq.${USER_A}`);
    await expect(res.json()).resolves.toEqual([]); // B's row filtered out, not returned
  });
});

describe("cross-tenant isolation: route level (API-key auth path)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET /api/environments/:projectId → 404 for A when the project belongs to B", async () => {
    (verifyApiKey as any).mockResolvedValue({ userId: USER_A, scope: "read" });
    makePostgrestFetch({
      projects: [{ id: PROJECT_B, user_id: USER_B }],
      project_environments: [
        { id: ENV_B, project_id: PROJECT_B, name: "prod", slug: "prod", is_default: true, display_order: 0 },
      ],
    });

    const app = createApp();
    app.route("/api/environments", environmentsRouter);

    const res = await app.request(
      `/api/environments/${PROJECT_B}`,
      { headers: { Authorization: "Bearer lnr_testkey" } },
      ENV,
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });
});
