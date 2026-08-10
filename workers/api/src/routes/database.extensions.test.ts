import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { databaseRouter } from "./database";

// Pattern copied verbatim from database.rows.test.ts's harness (buildApp +
// userId middleware + module mocks), extended with introspectExtensions.

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

import * as sb from "../connectors/supabase";
import * as utils from "../utils";

const USER_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

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

const EXTENSIONS_FIXTURE = [
  {
    name: "vector",
    installed: true,
    installedVersion: "0.5.1",
    description: "pgvector — vector similarity search for AI embeddings / semantic search.",
  },
  {
    name: "pgcrypto",
    installed: false,
    installedVersion: null,
    description: "Cryptographic functions (gen_random_uuid, digest, hmac, crypt).",
  },
];

describe("GET /:projectId/:nodeId/extensions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (sb.resolveSupabaseNode as any) = vi.fn();
    (sb.introspectExtensions as any) = vi.fn();
    (utils.getUserToken as any) = vi.fn(async () => "tok");
  });

  it("returns 409 when the node is not provisioned (draft)", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: null,
      provisioned: false,
    });

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request("/p1/n1/extensions", {}, env);

    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error).toBe("Node is not provisioned yet.");
    expect(sb.introspectExtensions).not.toHaveBeenCalled();
  });

  it("returns 200 with the extensions array on the happy path", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: "abc-ref",
      provisioned: true,
    });
    (sb.introspectExtensions as any).mockResolvedValue(EXTENSIONS_FIXTURE);

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request("/p1/n1/extensions", {}, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ extensions: EXTENSIONS_FIXTURE });
    expect(sb.introspectExtensions).toHaveBeenCalledWith("tok", "abc-ref");
  });

  it("returns 404 when resolveSupabaseNode throws a not-found error", async () => {
    (sb.resolveSupabaseNode as any).mockRejectedValue(
      new Error("Project not found"),
    );

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request("/p1/n1/extensions", {}, env);

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toBe("Project not found");
  });

  it("returns 422 when introspectExtensions (Management API) throws", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: "abc-ref",
      provisioned: true,
    });
    (sb.introspectExtensions as any).mockRejectedValue(
      new Error("Management API unavailable"),
    );

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request("/p1/n1/extensions", {}, env);

    expect(res.status).toBe(422);
    const body = (await res.json()) as any;
    expect(body.error).toBe("Management API unavailable");
  });
});

describe("POST /:projectId/:nodeId/extensions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (sb.resolveSupabaseNode as any) = vi.fn();
    (sb.executeSql as any) = vi.fn();
    (utils.getUserToken as any) = vi.fn(async () => "tok");
  });

  it("returns 409 when the node is not provisioned (draft)", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: null,
      provisioned: false,
    });

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request("/p1/n1/extensions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "vector", enabled: true }),
    }, env);

    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error).toBe("Node is not provisioned yet.");
    expect(sb.executeSql).not.toHaveBeenCalled();
  });

  it("enables a whitelisted extension on the happy path", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: "abc-ref",
      provisioned: true,
    });
    const result = { columns: [], rows: [], rowCount: 0, truncated: false };
    (sb.executeSql as any).mockResolvedValue(result);

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request("/p1/n1/extensions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "vector", enabled: true }),
    }, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result });
    expect(sb.executeSql).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      'CREATE EXTENSION IF NOT EXISTS "vector";',
      "write",
    );
  });

  it("disables a whitelisted extension", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: "abc-ref",
      provisioned: true,
    });
    const result = { columns: [], rows: [], rowCount: 0, truncated: false };
    (sb.executeSql as any).mockResolvedValue(result);

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request("/p1/n1/extensions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "vector", enabled: false }),
    }, env);

    expect(res.status).toBe(200);
    expect(sb.executeSql).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      'DROP EXTENSION IF EXISTS "vector";',
      "write",
    );
  });

  it("returns 400 for a non-whitelisted extension name, without calling executeSql", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: "abc-ref",
      provisioned: true,
    });

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request("/p1/n1/extensions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "pg_cron", enabled: true }),
    }, env);

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/not allowed/i);
    expect(sb.executeSql).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed body (missing name)", async () => {
    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request("/p1/n1/extensions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    }, env);

    expect(res.status).toBe(400);
    expect(sb.resolveSupabaseNode).not.toHaveBeenCalled();
    expect(sb.executeSql).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed body (enabled not boolean)", async () => {
    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request("/p1/n1/extensions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "vector", enabled: "yes" }),
    }, env);

    expect(res.status).toBe(400);
    expect(sb.executeSql).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON body", async () => {
    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request("/p1/n1/extensions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    }, env);

    expect(res.status).toBe(400);
  });

  it("returns 422 when executeSql (Management API) throws", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: "abc-ref",
      provisioned: true,
    });
    (sb.executeSql as any).mockRejectedValue(new Error("db unreachable"));

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request("/p1/n1/extensions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "vector", enabled: true }),
    }, env);

    expect(res.status).toBe(422);
    const body = (await res.json()) as any;
    expect(body.error).toBe("db unreachable");
  });
});
