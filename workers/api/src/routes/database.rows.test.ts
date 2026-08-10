import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { databaseRouter } from "./database";

// Pattern copied verbatim from database.test.ts's harness (buildApp + userId
// middleware + module mocks), extended with the rows connector.

vi.mock("../connectors/supabase", () => ({
  resolveSupabaseNode: vi.fn(),
  introspectSchema: vi.fn(),
  executeSql: vi.fn(),
  applySchemaMutation: vi.fn(),
  refreshNodeSnapshot: vi.fn(async () => undefined),
}));
vi.mock("../connectors/rows", () => ({
  selectRows: vi.fn(),
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

describe("GET /:projectId/:nodeId/tables/:table/rows", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (sb.resolveSupabaseNode as any) = vi.fn();
    (rowsConnector.selectRows as any) = vi.fn();
    (utils.getUserToken as any) = vi.fn(async () => "tok");
  });

  it("returns 409 when the node is not provisioned (draft)", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: null,
      provisioned: false,
    });

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request("/p1/n1/tables/users/rows", {}, env);

    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error).toBe("Node is not provisioned yet.");
    expect(rowsConnector.selectRows).not.toHaveBeenCalled();
  });

  it("returns 200 with a RowsPage on the happy path, defaulting limit=50 offset=0", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: "abc-ref",
      provisioned: true,
    });
    const page = {
      columns: ["id", "name"],
      rows: [[1, "a"]],
      rowCount: 1,
      truncated: false,
      limit: 50,
      offset: 0,
    };
    (rowsConnector.selectRows as any).mockResolvedValue(page);

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request("/p1/n1/tables/users/rows", {}, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(page);
    expect(rowsConnector.selectRows).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      "users",
      { limit: 50, offset: 0, orderBy: undefined, orderDir: "asc" },
    );
  });

  it("passes through custom limit/offset/orderBy/orderDir query params", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: "abc-ref",
      provisioned: true,
    });
    (rowsConnector.selectRows as any).mockResolvedValue({
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      limit: 10,
      offset: 20,
    });

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      "/p1/n1/tables/users/rows?limit=10&offset=20&orderBy=created_at&orderDir=desc",
      {},
      env,
    );

    expect(res.status).toBe(200);
    expect(rowsConnector.selectRows).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      "users",
      { limit: 10, offset: 20, orderBy: "created_at", orderDir: "desc" },
    );
  });

  it("coerces an invalid orderDir to asc", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: "abc-ref",
      provisioned: true,
    });
    (rowsConnector.selectRows as any).mockResolvedValue({
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      limit: 50,
      offset: 0,
    });

    const env = makeEnv();
    const app = buildApp(env);
    await app.request("/p1/n1/tables/users/rows?orderDir=bogus", {}, env);

    expect(rowsConnector.selectRows).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      "users",
      { limit: 50, offset: 0, orderBy: undefined, orderDir: "asc" },
    );
  });

  it("falls back to default limit/offset when query params are non-numeric", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: "abc-ref",
      provisioned: true,
    });
    (rowsConnector.selectRows as any).mockResolvedValue({
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      limit: 50,
      offset: 0,
    });

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      "/p1/n1/tables/users/rows?limit=abc&offset=xyz",
      {},
      env,
    );

    expect(res.status).toBe(200);
    expect(rowsConnector.selectRows).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      "users",
      { limit: 50, offset: 0, orderBy: undefined, orderDir: "asc" },
    );
  });

  it("passes an over-cap limit straight through to selectRows, which is responsible for clamping", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: "abc-ref",
      provisioned: true,
    });
    (rowsConnector.selectRows as any).mockResolvedValue({
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      limit: 1000,
      offset: 0,
    });

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request(
      "/p1/n1/tables/users/rows?limit=999999",
      {},
      env,
    );

    expect(res.status).toBe(200);
    expect(rowsConnector.selectRows).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      "users",
      { limit: 999999, offset: 0, orderBy: undefined, orderDir: "asc" },
    );
  });

  it("returns 404 when resolveSupabaseNode throws a not-found error", async () => {
    (sb.resolveSupabaseNode as any).mockRejectedValue(
      new Error("Project not found"),
    );

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request("/p1/n1/tables/users/rows", {}, env);

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toBe("Project not found");
    expect(rowsConnector.selectRows).not.toHaveBeenCalled();
  });

  it("returns 500 when resolveSupabaseNode throws an infra error", async () => {
    (sb.resolveSupabaseNode as any).mockRejectedValue(
      new Error("Failed to fetch project"),
    );

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request("/p1/n1/tables/users/rows", {}, env);

    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.error).toBe("Failed to fetch project");
  });

  it("returns 422 when selectRows (Management API) throws", async () => {
    (sb.resolveSupabaseNode as any).mockResolvedValue({
      ref: "abc-ref",
      provisioned: true,
    });
    (rowsConnector.selectRows as any).mockRejectedValue(
      new Error('relation "users" does not exist'),
    );

    const env = makeEnv();
    const app = buildApp(env);
    const res = await app.request("/p1/n1/tables/users/rows", {}, env);

    expect(res.status).toBe(422);
    const body = (await res.json()) as any;
    expect(body.error).toBe('relation "users" does not exist');
  });
});
