import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  markConfigOnlyNodesProvisioned,
  forceUnlock,
  releaseLock,
} from "./canvasVersion";

const ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
} as any;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("markConfigOnlyNodesProvisioned", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes("select=canvas,canvas_version")) {
        return Promise.resolve(
          json([
            {
              canvas: {
                nodes: [
                  { id: "gh-1", data: { provider: "github", status: "idle" } },
                ],
                edges: [],
              },
              canvas_version: 3,
            },
          ]),
        );
      }
      if (u.includes("project_env_node_state") && u.includes("select=state")) {
        return Promise.resolve(json([])); // no existing env state
      }
      if (u.includes("project_env_node_state")) {
        return Promise.resolve(json([], 201)); // POST upsert
      }
      // PATCH projects → return a representation row so the retry loop stops
      return Promise.resolve(json([{ id: "p1" }]));
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("upserts provisioned status into project_env_node_state for config-only nodes", async () => {
    await markConfigOnlyNodesProvisioned(ENV, "p1", "env-1");

    const envStatePost = fetchMock.mock.calls.find(([url, init]) => {
      return (
        String(url).includes("project_env_node_state") &&
        (init as any)?.method === "POST"
      );
    });
    expect(envStatePost).toBeTruthy();
    const body = JSON.parse((envStatePost![1] as any).body);
    expect(body.environment_id).toBe("env-1");
    expect(body.node_id).toBe("gh-1");
    expect(body.state.status).toBe("provisioned");
  });

  it("does NOT write env state when environmentId is missing", async () => {
    await markConfigOnlyNodesProvisioned(ENV, "p1");
    const envStatePost = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes("project_env_node_state") &&
        (init as any)?.method === "POST",
    );
    expect(envStatePost).toBeFalsy();
  });
});

describe("forceUnlock — age window aligned to DO timeout", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const PID = "aabbccdd-0000-0000-0000-000000000009";
  const UID = "aabbccdd-0000-0000-0000-000000000008";
  const env = { SUPABASE_URL: "https://s.test", SUPABASE_SERVICE_ROLE_KEY: "k" } as any;

  beforeEach(() => {
    fetchMock = vi.fn((url: string) => {
      const u = String(url);
      // Return a 6-minute-old lock for the first query
      if (u.includes("select=id,canvas_locked_at,canvas_locked_by")) {
        const sixMinAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
        return Promise.resolve(
          Response.json([{ id: PID, canvas_locked_at: sixMinAgo, canvas_locked_by: UID }]),
        );
      }
      // Return empty stacks for any other query
      return Promise.resolve(Response.json([]));
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("refuses to unlock a lock only 6 minutes old (was allowed at 5 min)", async () => {
    const res = await forceUnlock(env, PID, UID);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/minutes old/i);
  });
});

describe("releaseLock — owner scoping (migration 076)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const PID = "aabbccdd-0000-0000-0000-00000000000a";
  const UID = "aabbccdd-0000-0000-0000-00000000000b";
  const env = {
    SUPABASE_URL: "https://s.test",
    SUPABASE_SERVICE_ROLE_KEY: "k",
  } as any;

  const rpcBody = () => {
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("rpc/release_canvas_lock"),
    );
    expect(call).toBeTruthy();
    return JSON.parse((call![1] as any).body);
  };

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(json(true)));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends p_user_id so the DB can scope the release to the owner", async () => {
    await releaseLock(env, PID, UID);
    expect(rpcBody()).toEqual({ p_project_id: PID, p_user_id: UID });
  });

  it("OMITS p_user_id when the caller has no user in hand", async () => {
    // The DO's watchdog/recovery paths hit this (WatchdogState.userId is
    // optional). Omitting the key — rather than sending null — is what keeps
    // the call resolvable against a database that has not taken 076 yet.
    await releaseLock(env, PID);
    const body = rpcBody();
    expect(body).toEqual({ p_project_id: PID });
    expect("p_user_id" in body).toBe(false);
  });

  it("forceUnlock releases as the verified owner", async () => {
    // Ownership is established by the scopedQuery above the release; the RPC
    // must be told about it too, or the in-body check is a no-op there.
    fetchMock = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes("select=id,canvas_locked_at,canvas_locked_by")) {
        const old = new Date(Date.now() - 20 * 60 * 1000).toISOString();
        return Promise.resolve(
          json([{ id: PID, canvas_locked_at: old, canvas_locked_by: UID }]),
        );
      }
      return Promise.resolve(json([]));
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await forceUnlock(env, PID, UID);
    expect(res.ok).toBe(true);
    expect(rpcBody()).toEqual({ p_project_id: PID, p_user_id: UID });
  });
});
