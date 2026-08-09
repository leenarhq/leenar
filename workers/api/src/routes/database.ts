import { Hono } from "hono";
import type { Env } from "../types";
import { getUserToken } from "../utils";
import { createLogger } from "../logger";
import {
  resolveSupabaseNode,
  introspectSchema,
  introspectExtensions,
  executeSql,
  applySchemaMutation,
  refreshNodeSnapshot,
} from "../connectors/supabase";
import {
  selectRows,
  insertRow,
  updateRowByPk,
  deleteRowByPk,
} from "../connectors/rows";
import { listSnippets, createSnippet, deleteSnippet } from "../connectors/snippets";
import {
  applyMutationToSeed,
  buildDDL,
  type SchemaMutation,
  type TableDef,
} from "../schema/supabaseSchema";
import {
  assertWhitelistedExtension,
  buildEnableExtensionDDL,
  buildDisableExtensionDDL,
} from "../schema/extensions";
import { commitCanvasTables, getNodeData } from "../canvasTables";

const log = createLogger({ route: "database" });

// resolveSupabaseNode throws these exact messages for not-found / not-owned /
// wrong-type resource resolution. The codebase convention (uptime.ts, logs.ts,
// webhooks.ts, incidents.ts) maps such cases to 404; genuine infra failures
// (e.g. "Failed to fetch project") stay 500.
const NOT_FOUND_MESSAGES = new Set([
  "Project not found",
  "Node not found",
  "Node is not a Supabase node",
]);
const resolverErrorStatus = (msg: string): 404 | 500 =>
  NOT_FOUND_MESSAGES.has(msg) ? 404 : 500;

// Draft /mutate's catch now sees errors from BOTH commitCanvasTables's own
// canvas machinery (canvas_conflict, "Node not found", "Workflow not found",
// "Failed to fetch workflow", "Failed to update node" — same shapes the
// resolver already maps) AND from the updater's applyMutationToSeed reducer
// running inside it (reserved column, unknown table/column, createIndex/
// dropIndex/setRls-on-draft, bad identifier — all validation, i.e. 400).
// Check the specific/known shapes first; anything else falls through to 400
// as a reducer/validation error.
const draftMutateErrorStatus = (msg: string): 400 | 404 | 409 | 500 => {
  if (msg.startsWith("canvas_conflict")) return 409;
  if (NOT_FOUND_MESSAGES.has(msg) || msg === "Workflow not found") return 404;
  if (msg === "Failed to fetch workflow" || msg === "Failed to update node")
    return 500;
  return 400;
};

export const databaseRouter = new Hono<{
  Bindings: Env;
  Variables: { userId: string };
}>();

databaseRouter.get("/:projectId/:nodeId/schema", async (c) => {
  const userId = c.get("userId");
  const { projectId, nodeId } = c.req.param();
  try {
    const { ref, provisioned } = await resolveSupabaseNode(
      c.env,
      userId,
      projectId,
      nodeId,
    );
    if (!provisioned || !ref) {
      return c.json({ error: "Node is not provisioned yet." }, 409);
    }
    const token = await getUserToken(c.env, userId, "supabase");
    const schema = await introspectSchema(token, ref);

    // Back-compat: reconcile a pre-upgrade node's stale canvas snapshot
    // ONCE, on first Database-page schema load. Legacy = still carries
    // appliedColumns, or has never been snapshotted. Reuses the schema
    // already introspected above (no second introspection) and must never
    // affect this response — failures here are swallowed.
    try {
      const data = await getNodeData(c.env, userId, projectId, nodeId);
      const isLegacy =
        !!data &&
        (data.appliedColumns !== undefined ||
          data.schemaSnapshotAt === undefined);
      if (isLegacy) {
        await refreshNodeSnapshot(c.env, userId, projectId, nodeId, schema);
      }
    } catch (e) {
      console.warn("snapshot reconcile on schema load failed (non-fatal)", e);
    }

    return c.json({ schema });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("db_schema_error", { projectId, nodeId, error: msg });
    return c.json({ error: msg }, resolverErrorStatus(msg));
  }
});

databaseRouter.get("/:projectId/:nodeId/tables/:table/rows", async (c) => {
  const userId = c.get("userId");
  const { projectId, nodeId, table } = c.req.param();

  const q = c.req.query();
  // Guard against non-numeric query params (e.g. ?limit=abc → Number()=NaN,
  // which survives selectRows' Math.trunc/max/min clamps and would splice a
  // literal `LIMIT NaN` into the SQL). Fall back to the defaults on bad input;
  // selectRows still clamps the finite values to [1, MAX_ROWS] / >= 0.
  const limitNum = Number(q.limit);
  const offsetNum = Number(q.offset);
  const limit =
    q.limit !== undefined && Number.isFinite(limitNum) ? limitNum : 50;
  const offset =
    q.offset !== undefined && Number.isFinite(offsetNum) ? offsetNum : 0;
  const orderBy = q.orderBy || undefined;
  const orderDir = q.orderDir === "desc" ? "desc" : "asc";

  try {
    const { ref, provisioned } = await resolveSupabaseNode(
      c.env,
      userId,
      projectId,
      nodeId,
    );
    if (!provisioned || !ref) {
      return c.json({ error: "Node is not provisioned yet." }, 409);
    }

    const token = await getUserToken(c.env, userId, "supabase");
    try {
      const page = await selectRows(token, ref, table, {
        limit,
        offset,
        orderBy,
        orderDir,
      });
      return c.json(page);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("db_rows_exec_error", { projectId, nodeId, table, error: msg });
      return c.json({ error: msg }, 422);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("db_rows_error", { projectId, nodeId, table, error: msg });
    return c.json({ error: msg }, resolverErrorStatus(msg));
  }
});

// Route-only (no MCP tool) — row editing is a console UI feature, not an
// agent-driven action. Provisioned-only, tenancy-scoped via
// resolveSupabaseNode, same skeleton as the GET rows route above. Every
// value/identifier that reaches SQL is encoded inside the connector helpers
// (toSqlLiteral/qi) — this route only validates request shape.
databaseRouter.post("/:projectId/:nodeId/tables/:table/rows", async (c) => {
  const userId = c.get("userId");
  const { projectId, nodeId, table } = c.req.param();

  let body: { values?: Record<string, unknown> };
  try {
    body = await c.req.json<{ values?: Record<string, unknown> }>();
  } catch {
    return c.json({ error: "Invalid JSON body." }, 400);
  }

  const values = body.values;
  if (
    !values ||
    typeof values !== "object" ||
    Object.keys(values).length === 0
  ) {
    return c.json({ error: "values is required and must be non-empty." }, 400);
  }

  try {
    const { ref, provisioned } = await resolveSupabaseNode(
      c.env,
      userId,
      projectId,
      nodeId,
    );
    if (!provisioned || !ref) {
      return c.json({ error: "Node is not provisioned yet." }, 409);
    }

    const token = await getUserToken(c.env, userId, "supabase");
    try {
      const result = await insertRow(token, ref, table, values);
      return c.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("db_row_insert_exec_error", {
        projectId,
        nodeId,
        table,
        error: msg,
      });
      return c.json({ error: msg }, 422);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("db_row_insert_error", { projectId, nodeId, table, error: msg });
    return c.json({ error: msg }, resolverErrorStatus(msg));
  }
});

databaseRouter.patch("/:projectId/:nodeId/tables/:table/rows", async (c) => {
  const userId = c.get("userId");
  const { projectId, nodeId, table } = c.req.param();

  let body: { pk?: Record<string, unknown>; values?: Record<string, unknown> };
  try {
    body = await c.req.json<{
      pk?: Record<string, unknown>;
      values?: Record<string, unknown>;
    }>();
  } catch {
    return c.json({ error: "Invalid JSON body." }, 400);
  }

  const { pk, values } = body;
  if (!pk || typeof pk !== "object" || Object.keys(pk).length === 0) {
    return c.json({ error: "pk is required and must be non-empty." }, 400);
  }
  if (
    !values ||
    typeof values !== "object" ||
    Object.keys(values).length === 0
  ) {
    return c.json({ error: "values is required and must be non-empty." }, 400);
  }

  try {
    const { ref, provisioned } = await resolveSupabaseNode(
      c.env,
      userId,
      projectId,
      nodeId,
    );
    if (!provisioned || !ref) {
      return c.json({ error: "Node is not provisioned yet." }, 409);
    }

    const token = await getUserToken(c.env, userId, "supabase");
    try {
      const result = await updateRowByPk(token, ref, table, pk, values);
      return c.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("db_row_update_exec_error", {
        projectId,
        nodeId,
        table,
        error: msg,
      });
      return c.json({ error: msg }, 422);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("db_row_update_error", { projectId, nodeId, table, error: msg });
    return c.json({ error: msg }, resolverErrorStatus(msg));
  }
});

databaseRouter.delete("/:projectId/:nodeId/tables/:table/rows", async (c) => {
  const userId = c.get("userId");
  const { projectId, nodeId, table } = c.req.param();

  let body: { pk?: Record<string, unknown> };
  try {
    body = await c.req.json<{ pk?: Record<string, unknown> }>();
  } catch {
    return c.json({ error: "Invalid JSON body." }, 400);
  }

  const pk = body.pk;
  if (!pk || typeof pk !== "object" || Object.keys(pk).length === 0) {
    return c.json({ error: "pk is required and must be non-empty." }, 400);
  }

  try {
    const { ref, provisioned } = await resolveSupabaseNode(
      c.env,
      userId,
      projectId,
      nodeId,
    );
    if (!provisioned || !ref) {
      return c.json({ error: "Node is not provisioned yet." }, 409);
    }

    const token = await getUserToken(c.env, userId, "supabase");
    try {
      const result = await deleteRowByPk(token, ref, table, pk);
      return c.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("db_row_delete_exec_error", {
        projectId,
        nodeId,
        table,
        error: msg,
      });
      return c.json({ error: msg }, 422);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("db_row_delete_error", { projectId, nodeId, table, error: msg });
    return c.json({ error: msg }, resolverErrorStatus(msg));
  }
});

databaseRouter.post("/:projectId/:nodeId/query", async (c) => {
  const userId = c.get("userId");
  const { projectId, nodeId } = c.req.param();

  let body: { sql?: string; mode?: string };
  try {
    body = await c.req.json<{ sql?: string; mode?: string }>();
  } catch {
    return c.json({ error: "Invalid JSON body." }, 400);
  }

  const sql = body.sql;
  if (!sql || !sql.trim()) {
    return c.json({ error: "SQL is required." }, 400);
  }
  const runMode = body.mode === "write" ? "write" : "read";

  try {
    const { ref, provisioned } = await resolveSupabaseNode(
      c.env,
      userId,
      projectId,
      nodeId,
    );
    if (!provisioned || !ref) {
      return c.json({ error: "Node is not provisioned yet." }, 409);
    }

    const token = await getUserToken(c.env, userId, "supabase");
    const start = Date.now();
    try {
      const result = await executeSql(token, ref, sql, runMode);
      return c.json({ result, durationMs: Date.now() - start });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("db_query_exec_error", { projectId, nodeId, error: msg });
      return c.json({ error: msg }, 422);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("db_query_error", { projectId, nodeId, error: msg });
    return c.json({ error: msg }, resolverErrorStatus(msg));
  }
});

databaseRouter.post("/:projectId/:nodeId/mutate", async (c) => {
  const userId = c.get("userId");
  const { projectId, nodeId } = c.req.param();

  let body: { mutation?: SchemaMutation };
  try {
    body = await c.req.json<{ mutation?: SchemaMutation }>();
  } catch {
    return c.json({ error: "Invalid JSON body." }, 400);
  }

  const mutation = body.mutation;
  if (!mutation || typeof mutation !== "object" || !("kind" in mutation)) {
    return c.json({ error: "mutation is required." }, 400);
  }

  try {
    const { ref, provisioned } = await resolveSupabaseNode(
      c.env,
      userId,
      projectId,
      nodeId,
    );

    if (provisioned && ref) {
      const token = await getUserToken(c.env, userId, "supabase");
      const start = Date.now();
      try {
        const result = await applySchemaMutation(token, ref, mutation);
        try {
          await refreshNodeSnapshot(c.env, userId, projectId, nodeId);
        } catch (e) {
          console.warn("refreshNodeSnapshot failed (non-fatal)", e);
        }
        return c.json({ ok: true, result, durationMs: Date.now() - start });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error("db_mutate_exec_error", { projectId, nodeId, error: msg });
        return c.json({ error: msg }, 422);
      }
    }

    // Draft node: translate the mutation onto the canvas seed tables. The
    // read-reduce-write happens INSIDE commitCanvasTables's version-gated
    // snapshot (via the updater below) so a concurrent write landing between
    // "read current tables" and "patch" is caught as a stale-version conflict
    // instead of being silently overwritten (I1) — no separate pre-read here.
    try {
      await commitCanvasTables(c.env, userId, projectId, nodeId, (current) =>
        applyMutationToSeed(current, mutation),
      );
      return c.json({ ok: true, appliedToCanvas: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("db_mutate_draft_error", { projectId, nodeId, error: msg });
      return c.json({ error: msg }, draftMutateErrorStatus(msg));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("db_mutate_error", { projectId, nodeId, error: msg });
    return c.json({ error: msg }, resolverErrorStatus(msg));
  }
});

// Draft-only whole-array table persistence for the editable Tables tab's
// seed form (TableEditor). Provisioned nodes reject this with 409 — live
// schema editing goes through the granular /mutate route instead; a
// whole-array replace is out of scope for a provisioned database.
databaseRouter.put("/:projectId/:nodeId/tables", async (c) => {
  const userId = c.get("userId");
  const { projectId, nodeId } = c.req.param();

  let body: { tables?: unknown };
  try {
    body = await c.req.json<{ tables?: unknown }>();
  } catch {
    return c.json({ error: "Invalid JSON body." }, 400);
  }

  const tables = body.tables;
  if (!Array.isArray(tables)) {
    return c.json({ error: "tables must be an array." }, 400);
  }

  try {
    const { ref, provisioned } = await resolveSupabaseNode(
      c.env,
      userId,
      projectId,
      nodeId,
    );

    if (provisioned && ref) {
      return c.json(
        {
          error:
            "This node is provisioned — use per-mutation edits (POST /mutate).",
        },
        409,
      );
    }

    try {
      buildDDL(tables as TableDef[]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: msg }, 400);
    }

    try {
      await commitCanvasTables(
        c.env,
        userId,
        projectId,
        nodeId,
        tables as TableDef[],
      );
      return c.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("db_set_tables_error", { projectId, nodeId, error: msg });
      const status = msg.startsWith("canvas_conflict") ? 409 : 500;
      return c.json({ error: msg }, status);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("db_set_tables_resolve_error", { projectId, nodeId, error: msg });
    return c.json({ error: msg }, resolverErrorStatus(msg));
  }
});

// Extensions tab (Task 9 UI). Provisioned-only, tenancy-scoped via
// resolveSupabaseNode — same skeleton as the other provisioned-only routes
// above. introspectExtensions always returns exactly the closed whitelist
// (schema/extensions.ts), annotated with live install state.
databaseRouter.get("/:projectId/:nodeId/extensions", async (c) => {
  const userId = c.get("userId");
  const { projectId, nodeId } = c.req.param();

  try {
    const { ref, provisioned } = await resolveSupabaseNode(
      c.env,
      userId,
      projectId,
      nodeId,
    );
    if (!provisioned || !ref) {
      return c.json({ error: "Node is not provisioned yet." }, 409);
    }

    const token = await getUserToken(c.env, userId, "supabase");
    try {
      const extensions = await introspectExtensions(token, ref);
      return c.json({ extensions });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("db_extensions_exec_error", { projectId, nodeId, error: msg });
      return c.json({ error: msg }, 422);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("db_extensions_error", { projectId, nodeId, error: msg });
    return c.json({ error: msg }, resolverErrorStatus(msg));
  }
});

// A non-whitelisted extension name is a client error (400), NOT a 422 —
// assertWhitelistedExtension is checked BEFORE any DDL is built or executed,
// so executeSql is never reached for a rejected name. Draft nodes are
// rejected by the same 409 guard as every other provisioned-only route; we
// never enable/disable extensions against the canvas seed.
databaseRouter.post("/:projectId/:nodeId/extensions", async (c) => {
  const userId = c.get("userId");
  const { projectId, nodeId } = c.req.param();

  let body: { name?: unknown; enabled?: unknown };
  try {
    body = await c.req.json<{ name?: unknown; enabled?: unknown }>();
  } catch {
    return c.json({ error: "Invalid JSON body." }, 400);
  }

  const { name, enabled } = body;
  if (typeof name !== "string" || !name) {
    return c.json({ error: "name is required and must be a string." }, 400);
  }
  if (typeof enabled !== "boolean") {
    return c.json({ error: "enabled is required and must be a boolean." }, 400);
  }

  try {
    assertWhitelistedExtension(name);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 400);
  }

  try {
    const { ref, provisioned } = await resolveSupabaseNode(
      c.env,
      userId,
      projectId,
      nodeId,
    );
    if (!provisioned || !ref) {
      return c.json({ error: "Node is not provisioned yet." }, 409);
    }

    const token = await getUserToken(c.env, userId, "supabase");
    const ddl = enabled
      ? buildEnableExtensionDDL(name)
      : buildDisableExtensionDDL(name);
    try {
      const result = await executeSql(token, ref, ddl, "write");
      return c.json({ ok: true, result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("db_extensions_set_exec_error", {
        projectId,
        nodeId,
        name,
        error: msg,
      });
      return c.json({ error: msg }, 422);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("db_extensions_set_error", { projectId, nodeId, error: msg });
    return c.json({ error: msg }, resolverErrorStatus(msg));
  }
});

// ── Saved SQL snippets (SQL editor "save snippet" feature) ─────────────────
// These hit LEENAR'S OWN Postgres via the sb helper (PostgREST, service role) — NOT
// the user's Supabase project, and NOT resolveSupabaseNode/the Management
// API. Snippets are pure Leenar-DB metadata scoped by user+project+node
// strings; coupling them to project ownership/provisioning state is out of
// scope. Tenancy is enforced purely by user_id=eq.${userId} on every query —
// user_id always comes from the token, never the request body, and the
// DELETE filter additionally requires id=eq.<snippetId> so a guessed id from
// another tenant deletes zero rows.

databaseRouter.get("/:projectId/:nodeId/snippets", async (c) => {
  const userId = c.get("userId");
  const { projectId, nodeId } = c.req.param();

  try {
    const snippets = await listSnippets(c.env, userId, projectId, nodeId);
    return c.json({ snippets });
  } catch {
    return c.json({ error: "Failed to fetch snippets" }, 500);
  }
});

databaseRouter.post("/:projectId/:nodeId/snippets", async (c) => {
  const userId = c.get("userId");
  const { projectId, nodeId } = c.req.param();

  let body: { name?: unknown; sql?: unknown };
  try {
    body = await c.req.json<{ name?: unknown; sql?: unknown }>();
  } catch {
    return c.json({ error: "Invalid JSON body." }, 400);
  }

  const { name, sql } = body;
  if (typeof name !== "string" || !name.trim() || typeof sql !== "string" || !sql.trim()) {
    return c.json({ error: "name and sql are required." }, 400);
  }

  try {
    const snippet = await createSnippet(c.env, userId, projectId, nodeId, name, sql);
    return c.json({ snippet }, 201);
  } catch {
    return c.json({ error: "Failed to save snippet" }, 500);
  }
});

databaseRouter.delete("/:projectId/:nodeId/snippets/:snippetId", async (c) => {
  const userId = c.get("userId");
  const { snippetId } = c.req.param();

  try {
    await deleteSnippet(c.env, userId, snippetId);
    return c.json({ ok: true });
  } catch {
    return c.json({ error: "Failed to delete snippet" }, 500);
  }
});
