/**
 * Integration tests for environmentsRouter HTTP routes.
 * Uses Hono's app.request() with mocked fetch, following the pattern in
 * workflowProvision.integration.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { environmentsRouter } from "./environments";

// Audit-logging tests below call the exported *Data functions directly, and
// stub out envHelpers entirely so they only need to know about the fetch
// calls environments.ts itself makes (ownership checks, the mutating write,
// and the audit log POST) — not envHelpers' internal encryption/query shape.
vi.mock("../envHelpers", () => ({
  upsertEnvSecret: vi.fn().mockResolvedValue(undefined),
  deleteEnvSecret: vi.fn().mockResolvedValue(undefined),
  getAllEnvNodeState: vi.fn().mockResolvedValue({}),
  setEnvNodeState: vi.fn().mockResolvedValue(undefined),
  collectAllOverridesForEnv: vi.fn().mockResolvedValue({}),
}));

import {
  createEnvironmentData,
  updateEnvironmentData,
  deleteEnvironmentData,
  setEnvironmentSecretData,
  deleteEnvironmentSecretData,
  promoteEnvironmentData,
  branchEnvironmentData,
} from "./environments";
import { getAllEnvNodeState } from "../envHelpers";

const PROJECT_ID = "12345678-1234-1234-1234-123456789012";
const ENV_ID = "aabbccdd-0000-0000-0000-000000000099";
const DEFAULT_ENV_ID = "aabbccdd-0000-0000-0000-000000000098";
const NEW_ENV_ID = "aabbccdd-0000-0000-0000-000000000097";
const USER_ID = "aabbccdd-0000-0000-0000-000000000001";

const VALID_CANVAS = {
  nodes: [
    {
      id: "n1",
      type: "service",
      data: { provider: "github", label: "GitHub" },
      position: { x: 0, y: 0 },
    },
    {
      id: "n2",
      type: "service",
      data: { provider: "vercel", label: "Vercel" },
      position: { x: 300, y: 0 },
    },
  ],
  edges: [{ id: "e1", source: "n1", target: "n2" }],
};

function makeEnv() {
  return {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "svc-key",
  };
}

function buildApp(env: ReturnType<typeof makeEnv>) {
  const app = new Hono<{
    Bindings: typeof env;
    Variables: { userId: string };
  }>();
  app.use("*", async (c, next) => {
    c.set("userId", USER_ID);
    await next();
  });
  app.route("/", environmentsRouter);
  return { app, env };
}

async function req(
  app: Hono<any>,
  env: any,
  method: string,
  path: string,
  body?: unknown,
) {
  return app.request(
    path,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: body != null ? JSON.stringify(body) : undefined,
    },
    env,
  );
}

describe("PUT /:projectId/:envId/canvas", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockReset();
  });

  it("rejects a non-UUID envId with 400", async () => {
    const { app, env } = buildApp(makeEnv());
    const res = await req(
      app,
      env,
      "PUT",
      `/${PROJECT_ID}/not-a-uuid/canvas`,
      { nodes: [], edges: [] },
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when the caller does not own the project", async () => {
    const { app, env } = buildApp(makeEnv());
    // assertWorkflowOwner query → no rows
    fetchSpy.mockResolvedValueOnce(Response.json([]));
    const res = await req(
      app,
      env,
      "PUT",
      `/${PROJECT_ID}/${ENV_ID}/canvas`,
      { nodes: [], edges: [] },
    );
    expect(res.status).toBe(404);
  });

  it("rejects an invalid canvas shape (node missing id) with 400", async () => {
    const { app, env } = buildApp(makeEnv());
    // assertWorkflowOwner query → owns
    fetchSpy.mockResolvedValueOnce(Response.json([{ id: PROJECT_ID }]));
    const res = await req(
      app,
      env,
      "PUT",
      `/${PROJECT_ID}/${ENV_ID}/canvas`,
      {
        nodes: [{ type: "service", data: {} }], // missing id
        edges: [],
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/Invalid canvas/);
  });

  it("rejects a canvas exceeding the node-count max (>50) with 400", async () => {
    const { app, env } = buildApp(makeEnv());
    fetchSpy.mockResolvedValueOnce(Response.json([{ id: PROJECT_ID }]));
    const tooMany = Array.from({ length: 51 }, (_, i) => ({
      id: `n${i}`,
      type: "service",
      data: { provider: "github" },
    }));
    const res = await req(
      app,
      env,
      "PUT",
      `/${PROJECT_ID}/${ENV_ID}/canvas`,
      { nodes: tooMany, edges: [] },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/Invalid canvas/);
  });

  it("strips spoofed runtime keys from node data before persisting (legacy path)", async () => {
    const { app, env } = buildApp(makeEnv());
    // First fetch: the route handler's own assertWorkflowOwner → owns
    fetchSpy.mockResolvedValueOnce(Response.json([{ id: PROJECT_ID }]));
    // Second fetch: scopedByProject's internal (redundant, unreachable-in-
    // practice) re-verification of the same ownership → owns
    fetchSpy.mockResolvedValueOnce(Response.json([{ id: PROJECT_ID }]));
    // Third fetch: legacy PATCH write — capture body
    fetchSpy.mockResolvedValueOnce(
      Response.json([{ id: ENV_ID }], { status: 200 }),
    );

    const spoofedCanvas = {
      nodes: [
        {
          ...VALID_CANVAS.nodes[0],
          data: {
            ...VALID_CANVAS.nodes[0].data,
            status: "provisioned",
            provisionedUrl: "https://attacker.example.com",
            driftCount: 5,
          },
        },
        VALID_CANVAS.nodes[1],
      ],
      edges: VALID_CANVAS.edges,
    };

    const res = await req(
      app,
      env,
      "PUT",
      `/${PROJECT_ID}/${ENV_ID}/canvas`,
      spoofedCanvas,
    );
    expect(res.status).toBe(200);

    const patchCall = fetchSpy.mock.calls[2];
    const patchBody = JSON.parse(
      (patchCall[1] as RequestInit).body as string,
    );
    const persistedNode = patchBody.canvas.nodes.find(
      (n: any) => n.id === "n1",
    );
    expect(persistedNode.data.status).toBeUndefined();
    expect(persistedNode.data.provisionedUrl).toBeUndefined();
    expect(persistedNode.data.driftCount).toBeUndefined();
    expect(persistedNode.data.provider).toBe("github");
  });
});

// ─── Audit logging (previously missing entirely for every write in this file) ───
// Each test stubs fetch by URL pattern (matching environments.ts's own query
// shapes) with a catch-all default, so an unrecognized call (including the
// auditLog POST to user_audit_log) still resolves instead of hanging.
describe("audit logging for environment writes", () => {
  type Call = [string, RequestInit | undefined];

  function findAuditCall(calls: Call[]) {
    return calls.find(([url]) => url.includes("user_audit_log"));
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createEnvironmentData writes an environment_created audit log entry", async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push([url, init]);
        if (url.includes("projects?id=eq.") && url.includes("user_id=eq.")) {
          return Response.json([{ id: PROJECT_ID }]);
        }
        if (url.includes("project_environments") && url.includes("is_default=eq.true")) {
          return Response.json([]); // no default env yet — seed with empty canvas
        }
        if (url.includes("project_environments") && init?.method === "POST") {
          return Response.json([
            { id: NEW_ENV_ID, name: "Staging", slug: "staging", is_default: false, display_order: 0 },
          ]);
        }
        if (url.includes("project_environments")) {
          return Response.json([]); // count query — 0 existing environments
        }
        return Response.json([]);
      }),
    );

    const result = await createEnvironmentData(PROJECT_ID, "Staging", "staging", USER_ID, {} as any);
    expect("error" in result).toBe(false);

    const auditCall = findAuditCall(calls);
    expect(auditCall).toBeDefined();
    const body = JSON.parse(auditCall![1]!.body as string);
    expect(body.event).toBe("environment_created");
    expect(body.metadata).toMatchObject({ projectId: PROJECT_ID, environmentId: NEW_ENV_ID, slug: "staging" });
  });

  it("updateEnvironmentData writes an environment_updated audit log entry", async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push([url, init]);
        if (url.includes("project_environments?id=eq.") && !init?.method) {
          return Response.json([
            { id: ENV_ID, project_id: PROJECT_ID, name: "Staging", slug: "staging", is_default: false, display_order: 1 },
          ]);
        }
        if (url.includes("projects?id=eq.") && url.includes("user_id=eq.")) {
          return Response.json([{ id: PROJECT_ID }]);
        }
        if (url.includes("project_environments") && init?.method === "PATCH") {
          return Response.json([{ id: ENV_ID, name: "Staging 2" }]);
        }
        return Response.json([]);
      }),
    );

    const result = await updateEnvironmentData(ENV_ID, { name: "Staging 2" }, USER_ID, {} as any);
    expect("error" in result).toBe(false);

    const auditCall = findAuditCall(calls);
    expect(auditCall).toBeDefined();
    const body = JSON.parse(auditCall![1]!.body as string);
    expect(body.event).toBe("environment_updated");
    expect(body.metadata).toMatchObject({ environmentId: ENV_ID, projectId: PROJECT_ID });
  });

  it("deleteEnvironmentData writes an environment_deleted audit log entry", async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push([url, init]);
        if (url.includes("project_environments?id=eq.") && !init?.method) {
          return Response.json([
            { id: ENV_ID, project_id: PROJECT_ID, name: "Staging", slug: "staging", is_default: false, display_order: 1 },
          ]);
        }
        if (url.includes("projects?id=eq.") && url.includes("user_id=eq.")) {
          return Response.json([{ id: PROJECT_ID }]);
        }
        if (url.includes("project_env_node_state")) {
          return Response.json([]); // no provisioned nodes — deletion allowed
        }
        if (url.includes("project_environments") && init?.method === "DELETE") {
          return new Response(null, { status: 200 });
        }
        return Response.json([]);
      }),
    );

    const result = await deleteEnvironmentData(ENV_ID, USER_ID, {} as any);
    expect("error" in result).toBe(false);

    const auditCall = findAuditCall(calls);
    expect(auditCall).toBeDefined();
    const body = JSON.parse(auditCall![1]!.body as string);
    expect(body.event).toBe("environment_deleted");
    expect(body.metadata).toMatchObject({ environmentId: ENV_ID, projectId: PROJECT_ID });
  });

  function stubEnvOwner(calls: Call[], extra?: (url: string, init?: RequestInit) => Response | undefined) {
    return vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      const extraResult = extra?.(url, init);
      if (extraResult) return extraResult;
      if (url.includes("project_environments?id=eq.") && !init?.method) {
        return Response.json([
          { id: ENV_ID, project_id: PROJECT_ID, name: "Staging", slug: "staging", is_default: false, display_order: 1 },
        ]);
      }
      if (url.includes("projects?id=eq.") && url.includes("user_id=eq.")) {
        return Response.json([{ id: PROJECT_ID }]);
      }
      return Response.json([]);
    });
  }

  it("setEnvironmentSecretData writes an environment_secret_set entry — value never appears in metadata", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubEnvOwner(calls));

    const result = await setEnvironmentSecretData(
      ENV_ID,
      "node-1",
      "STRIPE_SECRET_KEY",
      "sk_live_super_secret_value",
      USER_ID,
      {} as any,
    );
    expect("error" in result).toBe(false);

    const auditCall = findAuditCall(calls);
    expect(auditCall).toBeDefined();
    const body = JSON.parse(auditCall![1]!.body as string);
    expect(body.event).toBe("environment_secret_set");
    expect(body.metadata).toMatchObject({ environmentId: ENV_ID, projectId: PROJECT_ID, nodeId: "node-1", key: "STRIPE_SECRET_KEY" });
    // The whole audit payload — not just `metadata` — must never carry the secret value.
    expect(JSON.stringify(body)).not.toContain("sk_live_super_secret_value");
  });

  it("deleteEnvironmentSecretData writes an environment_secret_deleted audit log entry", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", stubEnvOwner(calls));

    const result = await deleteEnvironmentSecretData(ENV_ID, "node-1", "STRIPE_SECRET_KEY", USER_ID, {} as any);
    expect("error" in result).toBe(false);

    const auditCall = findAuditCall(calls);
    expect(auditCall).toBeDefined();
    const body = JSON.parse(auditCall![1]!.body as string);
    expect(body.event).toBe("environment_secret_deleted");
    expect(body.metadata).toMatchObject({ environmentId: ENV_ID, projectId: PROJECT_ID, nodeId: "node-1", key: "STRIPE_SECRET_KEY" });
  });

  it("promoteEnvironmentData writes an environment_promoted audit log entry", async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      stubEnvOwner(calls, (url, init) => {
        if (url.includes("is_default=eq.true")) {
          return Response.json([{ id: DEFAULT_ENV_ID }]);
        }
        if (url.includes("project_env_node_state") && (!init?.method || init.method === "GET")) {
          return Response.json([{ node_id: "node-1", state: { region: "us-east-1" } }]);
        }
        if (url.includes("project_env_node_state") && init?.method === "POST") {
          return new Response(null, { status: 200 });
        }
        return undefined;
      }),
    );

    const result = await promoteEnvironmentData(PROJECT_ID, ENV_ID, USER_ID, {} as any);
    expect("error" in result).toBe(false);

    const auditCall = findAuditCall(calls);
    expect(auditCall).toBeDefined();
    const body = JSON.parse(auditCall![1]!.body as string);
    expect(body.event).toBe("environment_promoted");
    expect(body.metadata).toMatchObject({
      projectId: PROJECT_ID,
      sourceEnvironmentId: ENV_ID,
      targetEnvironmentId: DEFAULT_ENV_ID,
    });
  });

  it("branchEnvironmentData writes an environment_branched audit log entry", async () => {
    vi.mocked(getAllEnvNodeState).mockResolvedValueOnce({ n1: { status: "provisioned" } });
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      stubEnvOwner(
        calls,
        (url, init) => {
          // Order matters: project_environments?id=eq.<envId> is a shared URL prefix
          // for both assertEnvOwner's own fetch (select=id,project_id,...) and the
          // canvas fetch (select=canvas) — match on the distinguishing `select=`
          // clause, not the shared id=eq. prefix, or the two get confused.
          if (url.includes("select=canvas")) {
            return Response.json([
              { canvas: { nodes: [{ id: "n1", type: "service", data: { provider: "vercel" } }], edges: [] } },
            ]);
          }
          if (url.includes("select=id,project_id")) {
            // assertEnvOwner's own environment fetch — must be the default (trunk) env
            return Response.json([
              { id: ENV_ID, project_id: PROJECT_ID, name: "Production", slug: "production", is_default: true, display_order: 0 },
            ]);
          }
          if (url.includes("project_id=eq.") && url.includes("select=id")) {
            return Response.json([]); // environment count — 0 existing
          }
          if (url.includes("project_environments") && init?.method === "POST") {
            return Response.json([
              { id: NEW_ENV_ID, name: "Preview", slug: "preview", is_default: false, parent_id: ENV_ID },
            ]);
          }
          return undefined;
        },
      ),
    );

    const result = await branchEnvironmentData(PROJECT_ID, ENV_ID, "Preview", "preview", USER_ID, {} as any);
    expect("error" in result).toBe(false);

    const auditCall = findAuditCall(calls);
    expect(auditCall).toBeDefined();
    const body = JSON.parse(auditCall![1]!.body as string);
    expect(body.event).toBe("environment_branched");
    expect(body.metadata).toMatchObject({
      projectId: PROJECT_ID,
      parentEnvironmentId: ENV_ID,
      environmentId: NEW_ENV_ID,
      slug: "preview",
    });
  });
});
