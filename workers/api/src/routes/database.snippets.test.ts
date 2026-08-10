import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { databaseRouter } from "./database";

// Pattern copied verbatim from database.rows.test.ts's harness (buildApp +
// userId middleware + module mocks). Snippets hit Leenar's own Postgres via
// sb() (service role) — never resolveSupabaseNode/the user's project — so
// only ../utils's sb needs mocking here.

vi.mock("../connectors/supabase", () => ({
  resolveSupabaseNode: vi.fn(),
  introspectSchema: vi.fn(),
  introspectExtensions: vi.fn(),
  executeSql: vi.fn(),
  applySchemaMutation: vi.fn(),
  refreshNodeSnapshot: vi.fn(async () => undefined),
}));
vi.mock("../connectors/rows", () => ({
  selectRows: vi.fn(),
  insertRow: vi.fn(),
  updateRowByPk: vi.fn(),
  deleteRowByPk: vi.fn(),
}));
vi.mock("../utils", () => ({
  getUserToken: vi.fn(async () => "tok"),
  sb: vi.fn(),
}));
vi.mock("../canvasTables", () => ({
  commitCanvasTables: vi.fn(),
  getNodeData: vi.fn(async () => null),
}));

import * as utils from "../utils";

const USER_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const OTHER_USER_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const PROJECT_ID = "p1";
const NODE_ID = "n1";

function makeEnv() {
  return {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "svc-key",
  } as any;
}

function buildApp(env: any, userId = USER_ID) {
  const app = new Hono<{
    Bindings: typeof env;
    Variables: { userId: string };
  }>();
  app.use("*", async (c, next) => {
    c.set("userId", userId);
    await next();
  });
  app.route("/", databaseRouter);
  return app;
}

function jsonRes(body: unknown, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe("GET /:projectId/:nodeId/snippets", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (utils.sb as any) = vi.fn();
  });

  it("filters by user_id, project_id, node_id and orders by created_at.desc", async () => {
    (utils.sb as any).mockResolvedValue(
      jsonRes([
        {
          id: "s1",
          name: "count users",
          sql: "select count(*) from users",
          created_at: "2026-01-01T00:00:00Z",
        },
      ]),
    );

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      `/${PROJECT_ID}/${NODE_ID}/snippets`,
      {},
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toEqual({
      snippets: [
        {
          id: "s1",
          name: "count users",
          sql: "select count(*) from users",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const [, path] = (utils.sb as any).mock.calls[0];
    expect(path).toContain(`user_id=eq.${USER_ID}`);
    expect(path).toContain(`project_id=eq.${PROJECT_ID}`);
    expect(path).toContain(`node_id=eq.${NODE_ID}`);
    expect(path).toContain("order=created_at.desc");
  });

  it("returns 500 when sb() is not ok", async () => {
    (utils.sb as any).mockResolvedValue(jsonRes(null, false, 500));

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      `/${PROJECT_ID}/${NODE_ID}/snippets`,
      {},
      env,
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.error).toBe("Failed to fetch snippets");
  });
});

describe("POST /:projectId/:nodeId/snippets", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (utils.sb as any) = vi.fn();
  });

  it("inserts with user_id from the token, ignoring any body-supplied user_id (tenancy crux)", async () => {
    (utils.sb as any).mockResolvedValue(
      jsonRes([
        {
          id: "s2",
          name: "my snippet",
          sql: "select 1",
          created_at: "2026-01-02T00:00:00Z",
        },
      ]),
    );

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      `/${PROJECT_ID}/${NODE_ID}/snippets`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "my snippet",
          sql: "select 1",
          user_id: OTHER_USER_ID, // bogus, must be overridden/ignored
        }),
      },
      env,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body).toEqual({
      snippet: {
        id: "s2",
        name: "my snippet",
        sql: "select 1",
        createdAt: "2026-01-02T00:00:00Z",
      },
    });

    const [, path, init] = (utils.sb as any).mock.calls[0];
    expect(path).toBe("db_query_snippets");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Prefer: "return=representation" });
    const insertedBody = JSON.parse(init.body as string);
    expect(insertedBody.user_id).toBe(USER_ID);
    expect(insertedBody.user_id).not.toBe(OTHER_USER_ID);
    expect(insertedBody.project_id).toBe(PROJECT_ID);
    expect(insertedBody.node_id).toBe(NODE_ID);
    expect(insertedBody.name).toBe("my snippet");
    expect(insertedBody.sql).toBe("select 1");
  });

  it("400s on invalid JSON body", async () => {
    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      `/${PROJECT_ID}/${NODE_ID}/snippets`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      },
      env,
    );

    expect(res.status).toBe(400);
    expect(utils.sb).not.toHaveBeenCalled();
  });

  it("400s when name is empty", async () => {
    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      `/${PROJECT_ID}/${NODE_ID}/snippets`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "", sql: "select 1" }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe("name and sql are required.");
    expect(utils.sb).not.toHaveBeenCalled();
  });

  it("400s when sql is empty", async () => {
    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      `/${PROJECT_ID}/${NODE_ID}/snippets`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "my snippet", sql: "" }),
      },
      env,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe("name and sql are required.");
    expect(utils.sb).not.toHaveBeenCalled();
  });

  it("returns 500 when sb() insert is not ok", async () => {
    (utils.sb as any).mockResolvedValue(jsonRes(null, false, 500));

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      `/${PROJECT_ID}/${NODE_ID}/snippets`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "n", sql: "select 1" }),
      },
      env,
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.error).toBe("Failed to save snippet");
  });
});

describe("DELETE /:projectId/:nodeId/snippets/:snippetId", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (utils.sb as any) = vi.fn();
  });

  it("filters by BOTH id and user_id (cross-tenant delete guard)", async () => {
    (utils.sb as any).mockResolvedValue(jsonRes({}, true, 200));

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      `/${PROJECT_ID}/${NODE_ID}/snippets/s1`,
      { method: "DELETE" },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toEqual({ ok: true });

    const [, path, init] = (utils.sb as any).mock.calls[0];
    expect(path).toContain("id=eq.s1");
    expect(path).toContain(`user_id=eq.${USER_ID}`);
    expect(init.method).toBe("DELETE");
  });

  it("returns 500 when sb() delete is not ok", async () => {
    (utils.sb as any).mockResolvedValue(jsonRes(null, false, 500));

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      `/${PROJECT_ID}/${NODE_ID}/snippets/s1`,
      { method: "DELETE" },
      env,
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.error).toBe("Failed to delete snippet");
  });
});
