import { describe, it, expect, vi, afterEach } from "vitest";
import { scopedQuery, scopedByProject, NotOwnedError, systemQuery } from "./tenancy";
import { assertWorkflowOwner } from "./ownership";
import type { Env } from "./types";

vi.mock("./ownership", () => ({
  assertWorkflowOwner: vi.fn(),
  assertEnvOwner: vi.fn(),
}));

const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc" } as Env;

function stubFetch() {
  const f = vi.fn(async (_url: string, _init?: RequestInit) => new Response("[]", { status: 200 }));
  vi.stubGlobal("fetch", f);
  return f;
}

describe("scopedQuery (tier-1 user_id)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("injects user_id=eq into a GET query, before the extra params", () => {
    const f = stubFetch();
    scopedQuery(ENV, "u1", "projects", { query: "select=id&order=created_at.desc" });
    const url = String(f.mock.calls[0][0]);
    expect(url).toContain("/rest/v1/projects?user_id=eq.u1&select=id&order=created_at.desc");
  });

  it("injects user_id=eq for PATCH/DELETE (filter), never into the URL twice", () => {
    const f = stubFetch();
    scopedQuery(ENV, "u1", "api_keys", { method: "DELETE", query: "id=eq.k1" });
    const url = String(f.mock.calls[0][0]);
    expect(url).toContain("/rest/v1/api_keys?user_id=eq.u1&id=eq.k1");
    expect(url.match(/user_id=eq/g)?.length).toBe(1);
  });

  it("injects user_id into the BODY for a POST insert (object)", async () => {
    const f = stubFetch();
    scopedQuery(ENV, "u1", "db_query_snippets", { method: "POST", body: { name: "n" } });
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ name: "n", user_id: "u1" });
  });

  it("injects user_id into EVERY row for a POST insert (array)", async () => {
    const f = stubFetch();
    scopedQuery(ENV, "u1", "user_audit_log", { method: "POST", body: [{ event: "a" }, { event: "b" }] });
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual([
      { event: "a", user_id: "u1" },
      { event: "b", user_id: "u1" },
    ]);
  });
});

describe("scopedByProject (tier-2)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asserts project ownership then queries by project_id (no user_id on child table)", async () => {
    (assertWorkflowOwner as any).mockResolvedValue(true);
    const f = stubFetch();
    await scopedByProject(ENV, "u1", "p1", "metrics_snapshots", { query: "select=cpu" });
    const url = String(f.mock.calls[0][0]);
    expect(url).toContain("/rest/v1/metrics_snapshots?project_id=eq.p1&select=cpu");
    expect(url).not.toContain("user_id");
  });

  it("throws NotOwnedError and never queries when the caller does not own the project", async () => {
    (assertWorkflowOwner as any).mockResolvedValue(false);
    const f = stubFetch();
    await expect(scopedByProject(ENV, "u1", "p1", "metrics_snapshots")).rejects.toBeInstanceOf(NotOwnedError);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("systemQuery", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("passes the path straight through to sb without adding any tenant filter", () => {
    const f = stubFetch();
    systemQuery(ENV, "waitlist?select=email");
    expect(String(f.mock.calls[0][0])).toContain("/rest/v1/waitlist?select=email");
  });
});
