import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { databaseRouter } from "./database";

// Pattern copied verbatim from database.rows.test.ts's harness (buildApp +
// userId middleware + module mocks), extended with the rows-mutation
// connector helpers (insertRow/updateRowByPk/deleteRowByPk).

vi.mock("../connectors/supabase", () => ({
  resolveSupabaseNode: vi.fn(),
  introspectSchema: vi.fn(),
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
import * as rowsConnector from "../connectors/rows";
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

const okResult = {
  columns: ["id", "name"],
  rows: [[1, "x"]],
  rowCount: 1,
  truncated: false,
};

describe("POST /:projectId/:nodeId/tables/:table/rows (insert)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (sb.resolveSupabaseNode as any) = vi.fn();
    (rowsConnector.insertRow as any) = vi.fn();
    (utils.getUserToken as any) = vi.fn(async () => "tok");
  });

  it("returns 200 with the QueryResult on the happy path", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: "abc-ref",
      provisioned: true,
    });
    (rowsConnector.insertRow as any).mockResolvedValue(okResult);

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      "/p1/n1/tables/users/rows",
      {
        method: "POST",
        body: JSON.stringify({ values: { name: "x" } }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(okResult);
    expect(rowsConnector.insertRow).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      "users",
      { name: "x" },
    );
  });

  it("returns 400 when values is empty", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: "abc-ref",
      provisioned: true,
    });

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      "/p1/n1/tables/users/rows",
      { method: "POST", body: JSON.stringify({ values: {} }) },
      env,
    );

    expect(res.status).toBe(400);
    expect(rowsConnector.insertRow).not.toHaveBeenCalled();
  });

  it("returns 400 when values is absent", async () => {
    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      "/p1/n1/tables/users/rows",
      { method: "POST", body: JSON.stringify({}) },
      env,
    );

    expect(res.status).toBe(400);
    expect(rowsConnector.insertRow).not.toHaveBeenCalled();
  });

  it("returns 409 when the node is not provisioned (draft)", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: null,
      provisioned: false,
    });

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      "/p1/n1/tables/users/rows",
      { method: "POST", body: JSON.stringify({ values: { name: "x" } }) },
      env,
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error).toBe("Node is not provisioned yet.");
    expect(rowsConnector.insertRow).not.toHaveBeenCalled();
  });

  it("returns 422 when insertRow (Management API) throws", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: "abc-ref",
      provisioned: true,
    });
    (rowsConnector.insertRow as any).mockRejectedValue(
      new Error('relation "users" does not exist'),
    );

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      "/p1/n1/tables/users/rows",
      { method: "POST", body: JSON.stringify({ values: { name: "x" } }) },
      env,
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as any;
    expect(body.error).toBe('relation "users" does not exist');
  });
});

describe("PATCH /:projectId/:nodeId/tables/:table/rows (update)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (sb.resolveSupabaseNode as any) = vi.fn();
    (rowsConnector.updateRowByPk as any) = vi.fn();
    (utils.getUserToken as any) = vi.fn(async () => "tok");
  });

  it("returns 200 with the QueryResult on the happy path", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: "abc-ref",
      provisioned: true,
    });
    (rowsConnector.updateRowByPk as any).mockResolvedValue(okResult);

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      "/p1/n1/tables/users/rows",
      {
        method: "PATCH",
        body: JSON.stringify({ pk: { id: 1 }, values: { name: "y" } }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(okResult);
    expect(rowsConnector.updateRowByPk).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      "users",
      { id: 1 },
      { name: "y" },
    );
  });

  it("returns 400 when pk is empty", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: "abc-ref",
      provisioned: true,
    });

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      "/p1/n1/tables/users/rows",
      {
        method: "PATCH",
        body: JSON.stringify({ pk: {}, values: { name: "y" } }),
      },
      env,
    );

    expect(res.status).toBe(400);
    expect(rowsConnector.updateRowByPk).not.toHaveBeenCalled();
  });

  it("returns 400 when values is empty", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: "abc-ref",
      provisioned: true,
    });

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      "/p1/n1/tables/users/rows",
      {
        method: "PATCH",
        body: JSON.stringify({ pk: { id: 1 }, values: {} }),
      },
      env,
    );

    expect(res.status).toBe(400);
    expect(rowsConnector.updateRowByPk).not.toHaveBeenCalled();
  });

  it("returns 409 when the node is not provisioned (draft)", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: null,
      provisioned: false,
    });

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      "/p1/n1/tables/users/rows",
      {
        method: "PATCH",
        body: JSON.stringify({ pk: { id: 1 }, values: { name: "y" } }),
      },
      env,
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error).toBe("Node is not provisioned yet.");
    expect(rowsConnector.updateRowByPk).not.toHaveBeenCalled();
  });

  it("returns 422 when updateRowByPk (Management API) throws", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: "abc-ref",
      provisioned: true,
    });
    (rowsConnector.updateRowByPk as any).mockRejectedValue(
      new Error('relation "users" does not exist'),
    );

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      "/p1/n1/tables/users/rows",
      {
        method: "PATCH",
        body: JSON.stringify({ pk: { id: 1 }, values: { name: "y" } }),
      },
      env,
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as any;
    expect(body.error).toBe('relation "users" does not exist');
  });
});

describe("DELETE /:projectId/:nodeId/tables/:table/rows (delete)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (sb.resolveSupabaseNode as any) = vi.fn();
    (rowsConnector.deleteRowByPk as any) = vi.fn();
    (utils.getUserToken as any) = vi.fn(async () => "tok");
  });

  it("returns 200 with the QueryResult on the happy path", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: "abc-ref",
      provisioned: true,
    });
    (rowsConnector.deleteRowByPk as any).mockResolvedValue(okResult);

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      "/p1/n1/tables/users/rows",
      {
        method: "DELETE",
        body: JSON.stringify({ pk: { id: 1 } }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(okResult);
    expect(rowsConnector.deleteRowByPk).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      "users",
      { id: 1 },
    );
  });

  it("returns 400 when pk is empty", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: "abc-ref",
      provisioned: true,
    });

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      "/p1/n1/tables/users/rows",
      { method: "DELETE", body: JSON.stringify({ pk: {} }) },
      env,
    );

    expect(res.status).toBe(400);
    expect(rowsConnector.deleteRowByPk).not.toHaveBeenCalled();
  });

  it("returns 400 when pk is absent", async () => {
    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      "/p1/n1/tables/users/rows",
      { method: "DELETE", body: JSON.stringify({}) },
      env,
    );

    expect(res.status).toBe(400);
    expect(rowsConnector.deleteRowByPk).not.toHaveBeenCalled();
  });

  it("returns 409 when the node is not provisioned (draft)", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: null,
      provisioned: false,
    });

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      "/p1/n1/tables/users/rows",
      { method: "DELETE", body: JSON.stringify({ pk: { id: 1 } }) },
      env,
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error).toBe("Node is not provisioned yet.");
    expect(rowsConnector.deleteRowByPk).not.toHaveBeenCalled();
  });

  it("returns 422 when deleteRowByPk (Management API) throws", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: "abc-ref",
      provisioned: true,
    });
    (rowsConnector.deleteRowByPk as any).mockRejectedValue(
      new Error('relation "users" does not exist'),
    );

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      "/p1/n1/tables/users/rows",
      { method: "DELETE", body: JSON.stringify({ pk: { id: 1 } }) },
      env,
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as any;
    expect(body.error).toBe('relation "users" does not exist');
  });
});
