import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { databaseRouter } from "./database";

// ─── Mocks ───────────────────────────────────────────────────────────────────
// Pattern copied from webhooks.test.ts (buildApp + userId middleware) and
// connections.test.ts style vi.mock of collaborator modules.

vi.mock("../connectors/supabase", () => ({
  resolveSupabaseNode: vi.fn(),
  introspectSchema: vi.fn(),
  executeSql: vi.fn(),
  applySchemaMutation: vi.fn(),
  refreshNodeSnapshot: vi.fn(async () => undefined),
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
import { commitCanvasTables, getNodeData } from "../canvasTables";

// ─── Constants ───────────────────────────────────────────────────────────────

const USER_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

// ─── App builder (mirrors webhooks.test.ts's buildApp) ────────────────────────

function makeEnv() {
  return {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "svc-key",
  } as any;
}

function buildApp(env: any, userId = USER_ID) {
  const app = new Hono<{ Bindings: typeof env; Variables: { userId: string } }>();
  app.use("*", async (c, next) => {
    c.set("userId", userId);
    await next();
  });
  app.route("/", databaseRouter);
  return app;
}

describe("database router", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (sb.resolveSupabaseNode as any) = vi.fn();
    (sb.introspectSchema as any) = vi.fn();
    (sb.executeSql as any) = vi.fn();
    (sb.applySchemaMutation as any) = vi.fn();
    (sb.refreshNodeSnapshot as any) = vi.fn(async () => undefined);
    (utils.sb as any) = vi.fn();
    (commitCanvasTables as any) = vi.fn();
    (getNodeData as any) = vi.fn(async () => null);
  });

  describe("GET /:projectId/:nodeId/schema", () => {
    it("returns 409 when not provisioned", async () => {
      (sb.resolveSupabaseNode as any).mockResolvedValue({
        ref: null,
        provisioned: false,
      });

      const env = makeEnv();
      const app = buildApp(env);
      const res = await app.request("/p1/n1/schema", {}, env);

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body).toHaveProperty("error");
    });

    it("returns 200 with introspected schema when provisioned", async () => {
      (sb.resolveSupabaseNode as any).mockResolvedValue({
        ref: "abc-ref",
        provisioned: true,
      });
      (sb.introspectSchema as any).mockResolvedValue({ tables: [] });

      const env = makeEnv();
      const app = buildApp(env);
      const res = await app.request("/p1/n1/schema", {}, env);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ schema: { tables: [] } });
      expect(sb.introspectSchema).toHaveBeenCalledWith("tok", "abc-ref");
    });

    it("returns 404 when resolveSupabaseNode throws a not-found error", async () => {
      (sb.resolveSupabaseNode as any).mockRejectedValue(
        new Error("Project not found"),
      );

      const env = makeEnv();
      const app = buildApp(env);
      const res = await app.request("/p1/n1/schema", {}, env);

      expect(res.status).toBe(404);
      const body = (await res.json()) as any;
      expect(body.error).toBe("Project not found");
    });

    it("returns 500 when resolveSupabaseNode throws an infra error", async () => {
      (sb.resolveSupabaseNode as any).mockRejectedValue(
        new Error("Failed to fetch project"),
      );

      const env = makeEnv();
      const app = buildApp(env);
      const res = await app.request("/p1/n1/schema", {}, env);

      expect(res.status).toBe(500);
      const body = (await res.json()) as any;
      expect(body.error).toBe("Failed to fetch project");
    });

    // Task 3.5: back-compat reconcile of a pre-upgrade node's stale canvas
    // snapshot, gated on legacy markers, running once on first schema load.
    describe("back-compat snapshot reconcile", () => {
      it("invokes refreshNodeSnapshot with the just-introspected schema as prefetched when the node still carries appliedColumns", async () => {
        (sb.resolveSupabaseNode as any).mockResolvedValue({
          ref: "abc-ref",
          provisioned: true,
        });
        const schema = { tables: [{ name: "posts", columns: [] }] };
        (sb.introspectSchema as any).mockResolvedValue(schema);
        (getNodeData as any).mockResolvedValue({
          provider: "supabase",
          tables: [],
          appliedColumns: { posts: ["title"] },
          schemaSnapshotAt: "2026-01-01T00:00:00.000Z",
        });

        const env = makeEnv();
        const app = buildApp(env);
        const res = await app.request("/p1/n1/schema", {}, env);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ schema });
        expect(sb.refreshNodeSnapshot).toHaveBeenCalledWith(
          env,
          USER_ID,
          "p1",
          "n1",
          schema,
        );
      });

      it("invokes refreshNodeSnapshot when the node has never been snapshotted (schemaSnapshotAt undefined)", async () => {
        (sb.resolveSupabaseNode as any).mockResolvedValue({
          ref: "abc-ref",
          provisioned: true,
        });
        const schema = { tables: [] };
        (sb.introspectSchema as any).mockResolvedValue(schema);
        (getNodeData as any).mockResolvedValue({
          provider: "supabase",
          tables: [],
        });

        const env = makeEnv();
        const app = buildApp(env);
        const res = await app.request("/p1/n1/schema", {}, env);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ schema });
        expect(sb.refreshNodeSnapshot).toHaveBeenCalledWith(
          env,
          USER_ID,
          "p1",
          "n1",
          schema,
        );
      });

      it("does NOT invoke refreshNodeSnapshot for an already-reconciled node (no write churn)", async () => {
        (sb.resolveSupabaseNode as any).mockResolvedValue({
          ref: "abc-ref",
          provisioned: true,
        });
        const schema = { tables: [] };
        (sb.introspectSchema as any).mockResolvedValue(schema);
        (getNodeData as any).mockResolvedValue({
          provider: "supabase",
          tables: [],
          schemaSnapshotAt: "2026-01-01T00:00:00.000Z",
        });

        const env = makeEnv();
        const app = buildApp(env);
        const res = await app.request("/p1/n1/schema", {}, env);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ schema });
        expect(sb.refreshNodeSnapshot).not.toHaveBeenCalled();
      });

      it("does NOT invoke refreshNodeSnapshot when getNodeData resolves null (node/project not found)", async () => {
        (sb.resolveSupabaseNode as any).mockResolvedValue({
          ref: "abc-ref",
          provisioned: true,
        });
        const schema = { tables: [] };
        (sb.introspectSchema as any).mockResolvedValue(schema);
        (getNodeData as any).mockResolvedValue(null);

        const env = makeEnv();
        const app = buildApp(env);
        const res = await app.request("/p1/n1/schema", {}, env);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ schema });
        expect(sb.refreshNodeSnapshot).not.toHaveBeenCalled();
      });

      it("is non-fatal: still returns the normal 200 schema response when getNodeData throws", async () => {
        (sb.resolveSupabaseNode as any).mockResolvedValue({
          ref: "abc-ref",
          provisioned: true,
        });
        const schema = { tables: [] };
        (sb.introspectSchema as any).mockResolvedValue(schema);
        (getNodeData as any).mockRejectedValue(new Error("boom"));

        const env = makeEnv();
        const app = buildApp(env);
        const res = await app.request("/p1/n1/schema", {}, env);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ schema });
      });

      it("is non-fatal: still returns the normal 200 schema response when refreshNodeSnapshot rejects", async () => {
        (sb.resolveSupabaseNode as any).mockResolvedValue({
          ref: "abc-ref",
          provisioned: true,
        });
        const schema = { tables: [] };
        (sb.introspectSchema as any).mockResolvedValue(schema);
        (getNodeData as any).mockResolvedValue({
          provider: "supabase",
          tables: [],
          appliedColumns: { posts: ["title"] },
        });
        (sb.refreshNodeSnapshot as any).mockRejectedValue(
          new Error("refresh boom"),
        );

        const env = makeEnv();
        const app = buildApp(env);
        const res = await app.request("/p1/n1/schema", {}, env);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ schema });
      });
    });
  });

  describe("POST /:projectId/:nodeId/query", () => {
    it("rejects empty sql with 400", async () => {
      (sb.resolveSupabaseNode as any).mockResolvedValue({
        ref: "abc-ref",
        provisioned: true,
      });

      const env = makeEnv();
      const app = buildApp(env);
      const res = await app.request(
        "/p1/n1/query",
        {
          method: "POST",
          body: JSON.stringify({ sql: "", mode: "read" }),
          headers: { "content-type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(400);
      expect(sb.resolveSupabaseNode).not.toHaveBeenCalled();
    });

    it("rejects a malformed JSON body with 400", async () => {
      const env = makeEnv();
      const app = buildApp(env);
      const res = await app.request(
        "/p1/n1/query",
        {
          method: "POST",
          body: "{not valid json",
          headers: { "content-type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error).toBe("Invalid JSON body.");
      expect(sb.resolveSupabaseNode).not.toHaveBeenCalled();
    });

    it("rejects whitespace-only sql with 400", async () => {
      const env = makeEnv();
      const app = buildApp(env);
      const res = await app.request(
        "/p1/n1/query",
        {
          method: "POST",
          body: JSON.stringify({ sql: "   ", mode: "read" }),
          headers: { "content-type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(400);
    });

    it("returns 409 when not provisioned", async () => {
      (sb.resolveSupabaseNode as any).mockResolvedValue({
        ref: null,
        provisioned: false,
      });

      const env = makeEnv();
      const app = buildApp(env);
      const res = await app.request(
        "/p1/n1/query",
        {
          method: "POST",
          body: JSON.stringify({ sql: "select 1", mode: "read" }),
          headers: { "content-type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(409);
    });

    it("returns 404 when resolveSupabaseNode throws a not-found error", async () => {
      (sb.resolveSupabaseNode as any).mockRejectedValue(
        new Error("Project not found"),
      );

      const env = makeEnv();
      const app = buildApp(env);
      const res = await app.request(
        "/p1/n1/query",
        {
          method: "POST",
          body: JSON.stringify({ sql: "select 1", mode: "read" }),
          headers: { "content-type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(404);
      const body = (await res.json()) as any;
      expect(body.error).toBe("Project not found");
      // executeSql must never run when the node can't be resolved
      expect(sb.executeSql).not.toHaveBeenCalled();
    });

    it("returns 200 with result + durationMs on success, normalizing unknown mode to read", async () => {
      (sb.resolveSupabaseNode as any).mockResolvedValue({
        ref: "abc-ref",
        provisioned: true,
      });
      (sb.executeSql as any).mockResolvedValue({
        columns: ["id"],
        rows: [[1]],
        rowCount: 1,
        truncated: false,
      });

      const env = makeEnv();
      const app = buildApp(env);
      const res = await app.request(
        "/p1/n1/query",
        {
          method: "POST",
          body: JSON.stringify({ sql: "select 1", mode: "bogus" }),
          headers: { "content-type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.result).toEqual({
        columns: ["id"],
        rows: [[1]],
        rowCount: 1,
        truncated: false,
      });
      expect(typeof body.durationMs).toBe("number");
      expect(sb.executeSql).toHaveBeenCalledWith("tok", "abc-ref", "select 1", "read");
    });

    it("passes through mode 'write' exactly", async () => {
      (sb.resolveSupabaseNode as any).mockResolvedValue({
        ref: "abc-ref",
        provisioned: true,
      });
      (sb.executeSql as any).mockResolvedValue({
        columns: [],
        rows: [],
        rowCount: 0,
        truncated: false,
      });

      const env = makeEnv();
      const app = buildApp(env);
      await app.request(
        "/p1/n1/query",
        {
          method: "POST",
          body: JSON.stringify({ sql: "delete from x", mode: "write" }),
          headers: { "content-type": "application/json" },
        },
        env,
      );

      expect(sb.executeSql).toHaveBeenCalledWith(
        "tok",
        "abc-ref",
        "delete from x",
        "write",
      );
    });

    it("returns 404 when resolveSupabaseNode throws a not-found error", async () => {
      (sb.resolveSupabaseNode as any).mockRejectedValue(
        new Error("Project not found"),
      );

      const env = makeEnv();
      const app = buildApp(env);
      const res = await app.request(
        "/p1/n1/query",
        {
          method: "POST",
          body: JSON.stringify({ sql: "select 1", mode: "read" }),
          headers: { "content-type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(404);
      const body = (await res.json()) as any;
      expect(body.error).toBe("Project not found");
      expect(sb.executeSql).not.toHaveBeenCalled();
    });

    it("returns 422 when executeSql throws", async () => {
      (sb.resolveSupabaseNode as any).mockResolvedValue({
        ref: "abc-ref",
        provisioned: true,
      });
      (sb.executeSql as any).mockRejectedValue(new Error("syntax error"));

      const env = makeEnv();
      const app = buildApp(env);
      const res = await app.request(
        "/p1/n1/query",
        {
          method: "POST",
          body: JSON.stringify({ sql: "bad sql", mode: "read" }),
          headers: { "content-type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(422);
      const body = (await res.json()) as any;
      expect(body.error).toBe("syntax error");
    });
  });

  describe("POST /:projectId/:nodeId/mutate", () => {
    const CREATE_TABLE_MUTATION = {
      kind: "createTable",
      table: { name: "comment", columns: [{ name: "body", type: "text" }] },
    };

    it("rejects a malformed JSON body with 400", async () => {
      const env = makeEnv();
      const app = buildApp(env);
      const res = await app.request(
        "/p1/n1/mutate",
        {
          method: "POST",
          body: "{not valid json",
          headers: { "content-type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error).toBe("Invalid JSON body.");
      expect(sb.resolveSupabaseNode).not.toHaveBeenCalled();
    });

    it("rejects a body missing mutation with 400", async () => {
      const env = makeEnv();
      const app = buildApp(env);
      const res = await app.request(
        "/p1/n1/mutate",
        {
          method: "POST",
          body: JSON.stringify({}),
          headers: { "content-type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error).toBe("mutation is required.");
      expect(sb.resolveSupabaseNode).not.toHaveBeenCalled();
    });

    it("returns 404 when resolveSupabaseNode throws a not-found error", async () => {
      (sb.resolveSupabaseNode as any).mockRejectedValue(new Error("Node not found"));

      const env = makeEnv();
      const app = buildApp(env);
      const res = await app.request(
        "/p1/n1/mutate",
        {
          method: "POST",
          body: JSON.stringify({ mutation: CREATE_TABLE_MUTATION }),
          headers: { "content-type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(404);
      const body = (await res.json()) as any;
      expect(body.error).toBe("Node not found");
      expect(sb.applySchemaMutation).not.toHaveBeenCalled();
      expect(commitCanvasTables).not.toHaveBeenCalled();
    });

    describe("provisioned node", () => {
      it("applies the mutation live and returns { ok, result, durationMs }", async () => {
        (sb.resolveSupabaseNode as any).mockResolvedValue({
          ref: "abc-ref",
          provisioned: true,
        });
        (sb.applySchemaMutation as any).mockResolvedValue({
          columns: [],
          rows: [],
          rowCount: 0,
          truncated: false,
        });

        const env = makeEnv();
        const app = buildApp(env);
        const res = await app.request(
          "/p1/n1/mutate",
          {
            method: "POST",
            body: JSON.stringify({ mutation: CREATE_TABLE_MUTATION }),
            headers: { "content-type": "application/json" },
          },
          env,
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect(body.ok).toBe(true);
        expect(body.result).toEqual({ columns: [], rows: [], rowCount: 0, truncated: false });
        expect(typeof body.durationMs).toBe("number");
        expect(sb.applySchemaMutation).toHaveBeenCalledWith(
          "tok",
          "abc-ref",
          CREATE_TABLE_MUTATION,
        );
        expect(commitCanvasTables).not.toHaveBeenCalled();
      });

      it("returns 422 when applySchemaMutation throws (exec/validation error)", async () => {
        (sb.resolveSupabaseNode as any).mockResolvedValue({
          ref: "abc-ref",
          provisioned: true,
        });
        (sb.applySchemaMutation as any).mockRejectedValue(new Error("relation already exists"));

        const env = makeEnv();
        const app = buildApp(env);
        const res = await app.request(
          "/p1/n1/mutate",
          {
            method: "POST",
            body: JSON.stringify({ mutation: CREATE_TABLE_MUTATION }),
            headers: { "content-type": "application/json" },
          },
          env,
        );

        expect(res.status).toBe(422);
        const body = (await res.json()) as any;
        expect(body.error).toBe("relation already exists");
      });

      it("still returns success when refreshNodeSnapshot rejects (non-fatal, best-effort)", async () => {
        (sb.resolveSupabaseNode as any).mockResolvedValue({
          ref: "abc-ref",
          provisioned: true,
        });
        (sb.applySchemaMutation as any).mockResolvedValue({
          columns: [],
          rows: [],
          rowCount: 0,
          truncated: false,
        });
        (sb.refreshNodeSnapshot as any).mockRejectedValue(new Error("introspect boom"));

        const env = makeEnv();
        const app = buildApp(env);
        const res = await app.request(
          "/p1/n1/mutate",
          {
            method: "POST",
            body: JSON.stringify({ mutation: CREATE_TABLE_MUTATION }),
            headers: { "content-type": "application/json" },
          },
          env,
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect(body.ok).toBe(true);
        expect(sb.refreshNodeSnapshot).toHaveBeenCalled();
      });
    });

    // Phase 4a task 3: createPolicy/dropPolicy are new SchemaMutation kinds
    // (task 1-2). The route is fully kind-agnostic — it forwards any mutation
    // to applySchemaMutation (provisioned) / applyMutationToSeed (draft) —
    // so these tests just lock that a policy-kind mutation flows through the
    // same two branches as every other kind, without any kind-specific
    // route-level branching.
    describe("policy mutations (createPolicy/dropPolicy)", () => {
      const CREATE_POLICY_MUTATION = {
        kind: "createPolicy",
        table: "post",
        name: "p",
        command: "SELECT",
        using: "true",
      };

      it("provisioned node: applies createPolicy live and returns { ok, result, durationMs }", async () => {
        (sb.resolveSupabaseNode as any).mockResolvedValue({
          ref: "abc-ref",
          provisioned: true,
        });
        (sb.applySchemaMutation as any).mockResolvedValue({
          columns: [],
          rows: [],
          rowCount: 0,
          truncated: false,
        });

        const env = makeEnv();
        const app = buildApp(env);
        const res = await app.request(
          "/p1/n1/mutate",
          {
            method: "POST",
            body: JSON.stringify({ mutation: CREATE_POLICY_MUTATION }),
            headers: { "content-type": "application/json" },
          },
          env,
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect(body.ok).toBe(true);
        expect(body.result).toEqual({ columns: [], rows: [], rowCount: 0, truncated: false });
        expect(typeof body.durationMs).toBe("number");
        expect(sb.applySchemaMutation).toHaveBeenCalledWith(
          "tok",
          "abc-ref",
          CREATE_POLICY_MUTATION,
        );
        expect(commitCanvasTables).not.toHaveBeenCalled();
      });

      it("draft node: returns 400 for createPolicy (updater throws — policies are only supported on a provisioned database)", async () => {
        (sb.resolveSupabaseNode as any).mockResolvedValue({
          ref: null,
          provisioned: false,
        });
        (commitCanvasTables as any).mockImplementation(
          async (_env: any, _uid: any, _pid: any, _nid: any, updater: any) => {
            updater([{ name: "post", columns: [] }]);
            return { projectRef: null };
          },
        );

        const env = makeEnv();
        const app = buildApp(env);
        const res = await app.request(
          "/p1/n1/mutate",
          {
            method: "POST",
            body: JSON.stringify({ mutation: CREATE_POLICY_MUTATION }),
            headers: { "content-type": "application/json" },
          },
          env,
        );

        expect(res.status).toBe(400);
        const body = (await res.json()) as any;
        expect(body.error).toContain("createPolicy is only supported on a provisioned database");
      });
    });

    // I1 fix: the draft branch no longer does its own pre-read of the canvas —
    // it passes an updater `(current) => applyMutationToSeed(current, mutation)`
    // straight to commitCanvasTables, so the read-reduce-write happens INSIDE
    // commitCanvasTables's version-gated snapshot. These tests drive the mocked
    // commitCanvasTables directly: assert it's invoked with a function (not a
    // pre-computed array), and that invoking that function against a sample
    // "current" array reproduces the same reducer behavior (success, and each
    // validation error) the route used to compute itself.
    describe("draft node", () => {
      it("passes an updater to commitCanvasTables that applies the reducer, and returns { ok, appliedToCanvas }", async () => {
        (sb.resolveSupabaseNode as any).mockResolvedValue({
          ref: null,
          provisioned: false,
        });
        (commitCanvasTables as any).mockResolvedValue({ projectRef: null });

        const env = makeEnv();
        const app = buildApp(env);
        const res = await app.request(
          "/p1/n1/mutate",
          {
            method: "POST",
            body: JSON.stringify({ mutation: CREATE_TABLE_MUTATION }),
            headers: { "content-type": "application/json" },
          },
          env,
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect(body).toEqual({ ok: true, appliedToCanvas: true });
        expect(commitCanvasTables).toHaveBeenCalledTimes(1);
        // No separate pre-read: the route's own sb() mock was never touched.
        expect(utils.sb).not.toHaveBeenCalled();
        const callArgs = (commitCanvasTables as any).mock.calls[0];
        expect(callArgs[2]).toBe("p1"); // projectId
        expect(callArgs[3]).toBe("n1"); // nodeId
        const updater = callArgs[4];
        expect(typeof updater).toBe("function");
        // Invoking the updater against a sample "current" snapshot reproduces
        // the same reducer output the old pre-computed-array form would have.
        expect(updater([])).toEqual([
          { name: "comment", columns: [{ name: "body", type: "text" }] },
        ]);
      });

      it("returns 400 for createIndex on a draft node (updater throws inside commitCanvasTables)", async () => {
        (sb.resolveSupabaseNode as any).mockResolvedValue({
          ref: null,
          provisioned: false,
        });
        (commitCanvasTables as any).mockImplementation(
          async (_env: any, _uid: any, _pid: any, _nid: any, updater: any) => {
            updater([{ name: "post", columns: [] }]);
            return { projectRef: null };
          },
        );

        const env = makeEnv();
        const app = buildApp(env);
        const res = await app.request(
          "/p1/n1/mutate",
          {
            method: "POST",
            body: JSON.stringify({
              mutation: { kind: "createIndex", table: "post", columns: ["id"] },
            }),
            headers: { "content-type": "application/json" },
          },
          env,
        );

        expect(res.status).toBe(400);
        const body = (await res.json()) as any;
        expect(body.error).toContain("createIndex is only supported on a provisioned database");
      });

      it("returns 400 for a reserved-column mutation (dropColumn id) (updater throws inside commitCanvasTables)", async () => {
        (sb.resolveSupabaseNode as any).mockResolvedValue({
          ref: null,
          provisioned: false,
        });
        (commitCanvasTables as any).mockImplementation(
          async (_env: any, _uid: any, _pid: any, _nid: any, updater: any) => {
            updater([{ name: "post", columns: [] }]);
            return { projectRef: null };
          },
        );

        const env = makeEnv();
        const app = buildApp(env);
        const res = await app.request(
          "/p1/n1/mutate",
          {
            method: "POST",
            body: JSON.stringify({
              mutation: { kind: "dropColumn", table: "post", column: "id" },
            }),
            headers: { "content-type": "application/json" },
          },
          env,
        );

        expect(res.status).toBe(400);
        const body = (await res.json()) as any;
        expect(body.error).toBe('Column "id" is reserved and cannot be dropped');
      });

      it("returns 409 when commitCanvasTables/updater path throws canvas_conflict", async () => {
        (sb.resolveSupabaseNode as any).mockResolvedValue({
          ref: null,
          provisioned: false,
        });
        (commitCanvasTables as any).mockRejectedValue(
          new Error("canvas_conflict — canvas was modified concurrently. Re-fetch and retry."),
        );

        const env = makeEnv();
        const app = buildApp(env);
        const res = await app.request(
          "/p1/n1/mutate",
          {
            method: "POST",
            body: JSON.stringify({ mutation: CREATE_TABLE_MUTATION }),
            headers: { "content-type": "application/json" },
          },
          env,
        );

        expect(res.status).toBe(409);
        const body = (await res.json()) as any;
        expect(body.error).toContain("canvas_conflict");
      });

      it("returns 404 when commitCanvasTables throws a resolver-style not-found error", async () => {
        (sb.resolveSupabaseNode as any).mockResolvedValue({
          ref: null,
          provisioned: false,
        });
        (commitCanvasTables as any).mockRejectedValue(new Error("Node not found"));

        const env = makeEnv();
        const app = buildApp(env);
        const res = await app.request(
          "/p1/n1/mutate",
          {
            method: "POST",
            body: JSON.stringify({ mutation: CREATE_TABLE_MUTATION }),
            headers: { "content-type": "application/json" },
          },
          env,
        );

        expect(res.status).toBe(404);
        const body = (await res.json()) as any;
        expect(body.error).toBe("Node not found");
      });

      it("returns 500 when commitCanvasTables throws an infra error", async () => {
        (sb.resolveSupabaseNode as any).mockResolvedValue({
          ref: null,
          provisioned: false,
        });
        (commitCanvasTables as any).mockRejectedValue(new Error("Failed to update node"));

        const env = makeEnv();
        const app = buildApp(env);
        const res = await app.request(
          "/p1/n1/mutate",
          {
            method: "POST",
            body: JSON.stringify({ mutation: CREATE_TABLE_MUTATION }),
            headers: { "content-type": "application/json" },
          },
          env,
        );

        expect(res.status).toBe(500);
        const body = (await res.json()) as any;
        expect(body.error).toBe("Failed to update node");
      });
    });
  });

  describe("PUT /:projectId/:nodeId/tables", () => {
    const VALID_TABLES = [
      { name: "post", columns: [{ name: "body", type: "text" }] },
    ];

    it("rejects a malformed JSON body with 400", async () => {
      const env = makeEnv();
      const app = buildApp(env);
      const res = await app.request(
        "/p1/n1/tables",
        {
          method: "PUT",
          body: "{not valid json",
          headers: { "content-type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error).toBe("Invalid JSON body.");
      expect(sb.resolveSupabaseNode).not.toHaveBeenCalled();
    });

    it("rejects a body where tables is not an array with 400", async () => {
      const env = makeEnv();
      const app = buildApp(env);
      const res = await app.request(
        "/p1/n1/tables",
        {
          method: "PUT",
          body: JSON.stringify({ tables: "nope" }),
          headers: { "content-type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error).toBe("tables must be an array.");
      expect(sb.resolveSupabaseNode).not.toHaveBeenCalled();
    });

    it("rejects a body missing tables with 400", async () => {
      const env = makeEnv();
      const app = buildApp(env);
      const res = await app.request(
        "/p1/n1/tables",
        {
          method: "PUT",
          body: JSON.stringify({}),
          headers: { "content-type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error).toBe("tables must be an array.");
      expect(sb.resolveSupabaseNode).not.toHaveBeenCalled();
    });

    it("returns 404 when resolveSupabaseNode throws a not-found error", async () => {
      (sb.resolveSupabaseNode as any).mockRejectedValue(new Error("Node not found"));

      const env = makeEnv();
      const app = buildApp(env);
      const res = await app.request(
        "/p1/n1/tables",
        {
          method: "PUT",
          body: JSON.stringify({ tables: VALID_TABLES }),
          headers: { "content-type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(404);
      const body = (await res.json()) as any;
      expect(body.error).toBe("Node not found");
      expect(commitCanvasTables).not.toHaveBeenCalled();
    });

    it("returns 409 when the node is provisioned", async () => {
      (sb.resolveSupabaseNode as any).mockResolvedValue({
        ref: "abc-ref",
        provisioned: true,
      });

      const env = makeEnv();
      const app = buildApp(env);
      const res = await app.request(
        "/p1/n1/tables",
        {
          method: "PUT",
          body: JSON.stringify({ tables: VALID_TABLES }),
          headers: { "content-type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(409);
      const body = (await res.json()) as any;
      expect(body.error).toBe(
        "This node is provisioned — use per-mutation edits (POST /mutate).",
      );
      expect(commitCanvasTables).not.toHaveBeenCalled();
    });

    it("returns 400 when a table has an invalid identifier (buildDDL validation)", async () => {
      (sb.resolveSupabaseNode as any).mockResolvedValue({
        ref: null,
        provisioned: false,
      });

      const env = makeEnv();
      const app = buildApp(env);
      const res = await app.request(
        "/p1/n1/tables",
        {
          method: "PUT",
          body: JSON.stringify({
            tables: [{ name: "a b", columns: [] }],
          }),
          headers: { "content-type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error).toBe('Invalid table name: "a b"');
      expect(commitCanvasTables).not.toHaveBeenCalled();
    });

    it("commits to canvas and returns { ok: true } for a draft node", async () => {
      (sb.resolveSupabaseNode as any).mockResolvedValue({
        ref: null,
        provisioned: false,
      });
      (commitCanvasTables as any).mockResolvedValue({ projectRef: null });

      const env = makeEnv();
      const app = buildApp(env);
      const res = await app.request(
        "/p1/n1/tables",
        {
          method: "PUT",
          body: JSON.stringify({ tables: VALID_TABLES }),
          headers: { "content-type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body).toEqual({ ok: true });
      expect(commitCanvasTables).toHaveBeenCalledTimes(1);
      expect(commitCanvasTables).toHaveBeenCalledWith(
        env,
        USER_ID,
        "p1",
        "n1",
        VALID_TABLES,
      );
    });

    it("returns 409 when commitCanvasTables throws a canvas_conflict error", async () => {
      (sb.resolveSupabaseNode as any).mockResolvedValue({
        ref: null,
        provisioned: false,
      });
      (commitCanvasTables as any).mockRejectedValue(
        new Error("canvas_conflict — canvas was modified concurrently. Re-fetch and retry."),
      );

      const env = makeEnv();
      const app = buildApp(env);
      const res = await app.request(
        "/p1/n1/tables",
        {
          method: "PUT",
          body: JSON.stringify({ tables: VALID_TABLES }),
          headers: { "content-type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(409);
      const body = (await res.json()) as any;
      expect(body.error).toContain("canvas_conflict");
    });

    it("returns 500 when commitCanvasTables throws a non-conflict error", async () => {
      (sb.resolveSupabaseNode as any).mockResolvedValue({
        ref: null,
        provisioned: false,
      });
      (commitCanvasTables as any).mockRejectedValue(new Error("Failed to update node"));

      const env = makeEnv();
      const app = buildApp(env);
      const res = await app.request(
        "/p1/n1/tables",
        {
          method: "PUT",
          body: JSON.stringify({ tables: VALID_TABLES }),
          headers: { "content-type": "application/json" },
        },
        env,
      );

      expect(res.status).toBe(500);
      const body = (await res.json()) as any;
      expect(body.error).toBe("Failed to update node");
    });
  });
});
