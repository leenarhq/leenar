import { Hono } from "hono";
import type { Env } from "../types";
import { isUUID, auditLog } from "../utils";
import {
  patchEnvCanvasWithVersion,
  loadEnvCanvasWithVersion,
} from "../canvasVersion";
import {
  upsertEnvSecret,
  deleteEnvSecret,
  getAllEnvNodeState,
  setEnvNodeState,
  collectAllOverridesForEnv,
} from "../envHelpers";
import {
  stripRuntimeFromCanvas,
  stripRuntimeFromCanvasForNewEnvironment,
} from "../canvasRuntime";
import { CanvasSchema } from "./workflowProvision";
import { assertWorkflowOwner, assertEnvOwner } from "../ownership";
import { scopedByProject, scopedByEnv, NotOwnedError } from "../tenancy";

// Re-export so existing importers of these from this module keep working
// unchanged (e.g. `insights/collectors.ts`). The implementations now live in
// `../ownership.ts`, a leaf module with no dependents, to avoid a circular
// import with `tenancy.ts` (which also consumes these).
export { assertWorkflowOwner, assertEnvOwner };

export const environmentsRouter = new Hono<{
  Bindings: Env;
  Variables: { userId: string };
}>();

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

// Shape of a `project_environments` row as returned by create/update/branch —
// distinct from a plain `Record<string, unknown>` so TS can discriminate the
// `{error,status}` union in the shared handler functions below.
type EnvironmentRow = {
  id: string;
  project_id?: string;
  name: string;
  slug: string;
  is_default: boolean;
  display_order: number;
  created_at?: string;
  parent_id?: string | null;
  canvas?: unknown;
};

// Used when seeding a brand-new/copied environment (create, branch) — this
// also strips edge `synced`/`markerEnd` so inherited edges don't falsely
// show as synced against unprovisioned nodes in the new environment. Normal
// canvas saves (PUT/PATCH) call stripRuntimeFromCanvas directly instead,
// since those must NOT strip legitimately-synced edge state.
const stripResourceState = stripRuntimeFromCanvasForNewEnvironment;

// Shared logic — used by both the REST route and the MCP `list_environments` tool.
export async function listEnvironmentsData(
  projectId: string,
  userId: string,
  env: Env,
): Promise<{ error: string; status: 400 | 404 | 502 } | unknown[]> {
  if (!isUUID(projectId)) return { error: "Invalid project id", status: 400 };

  let res: Response;
  try {
    res = await scopedByProject(env, userId, projectId, "project_environments", {
      query: `order=display_order.asc,created_at.asc&select=id,name,slug,is_default,display_order,created_at,parent_id`,
    });
  } catch (e) {
    if (e instanceof NotOwnedError) return { error: "Not found", status: 404 };
    throw e;
  }
  if (!res.ok) return { error: "Failed to fetch environments", status: 502 };
  return (await res.json()) as unknown[];
}

// ── GET /api/environments/:projectId ─────────────────────────
environmentsRouter.get("/:projectId", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  const result = await listEnvironmentsData(projectId, userId, c.env);
  if (result && typeof result === "object" && "error" in result)
    return c.json({ error: result.error }, result.status);
  return c.json(result);
});

// Shared logic — used by both the REST route and the MCP `create_environment` tool.
export async function createEnvironmentData(
  projectId: string,
  name: string | undefined,
  slug: string | undefined,
  userId: string,
  env: Env,
): Promise<
  { error: string; status: 400 | 404 | 409 | 429 | 502 } | EnvironmentRow
> {
  if (!isUUID(projectId)) return { error: "Invalid project id", status: 400 };

  if (!(await assertWorkflowOwner(env, projectId, userId)))
    return { error: "Not found", status: 404 };

  const cleanName = name?.trim();
  const cleanSlug = slug?.trim().toLowerCase();

  if (!cleanName || cleanName.length > 64)
    return { error: "name required (max 64 chars)", status: 400 };
  if (!cleanSlug || !SLUG_RE.test(cleanSlug))
    return {
      error:
        "slug must be lowercase a-z0-9-, starting with letter/digit, max 32 chars",
      status: 400,
    };

  // NOTE: ownership of `projectId` was already verified above via
  // assertWorkflowOwner, before the name/slug validation ran (preserving the
  // original 404-before-400 precedence for a non-owner + invalid-input
  // combination). Each scopedByProject call below re-verifies ownership —
  // unreachable in practice, but kept so the child queries never bypass the
  // tenancy layer.
  let countRes: Response;
  try {
    countRes = await scopedByProject(env, userId, projectId, "project_environments", {
      query: `select=id`,
    });
  } catch (e) {
    if (!(e instanceof NotOwnedError)) throw e;
    return { error: "Failed to check environment count", status: 502 };
  }
  if (!countRes.ok)
    return { error: "Failed to check environment count", status: 502 };
  const existing = (await countRes.json()) as unknown[];
  if (existing.length >= 10)
    return { error: "Maximum 10 environments per project", status: 400 };

  const displayOrder = existing.length;

  // Seed new env with the default env's canvas so it starts with existing nodes
  let seedRes: Response | undefined;
  try {
    seedRes = await scopedByProject(env, userId, projectId, "project_environments", {
      query: `is_default=eq.true&select=canvas&limit=1`,
    });
  } catch (e) {
    if (!(e instanceof NotOwnedError)) throw e;
    // unreachable in practice — mirror the existing !seedRes.ok soft-fail
    // (empty seed canvas) rather than erroring.
  }
  const seedRows = seedRes?.ok
    ? ((await seedRes.json()) as Array<{ canvas: unknown }>)
    : [];
  const seedCanvas = stripResourceState(
    seedRows[0]?.canvas ?? { nodes: [], edges: [] },
  );

  let res: Response;
  try {
    res = await scopedByProject(env, userId, projectId, "project_environments", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        project_id: projectId,
        name: cleanName,
        slug: cleanSlug,
        is_default: false,
        display_order: displayOrder,
        canvas: seedCanvas,
      },
    });
  } catch (e) {
    if (!(e instanceof NotOwnedError)) throw e;
    return { error: "Not found", status: 404 };
  }
  if (!res.ok) {
    const err = await res.text();
    if (err.includes("Maximum of 10")) {
      return {
        error: "Maximum of 10 environments allowed per project",
        status: 429,
      };
    }
    if (err.includes("unique") || err.includes("duplicate")) {
      return {
        error: `Environment with slug "${cleanSlug}" already exists`,
        status: 409,
      };
    }
    return { error: "Failed to create environment", status: 502 };
  }

  const created = (await res.json()) as EnvironmentRow[];
  auditLog(env, userId, "environment_created", {
    projectId,
    environmentId: created[0]?.id,
    name: cleanName,
    slug: cleanSlug,
  });
  return created[0];
}

// ── POST /api/environments/:projectId ────────────────────────
environmentsRouter.post("/:projectId", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  const body = await c.req.json<{ name?: string; slug?: string }>();
  const result = await createEnvironmentData(
    projectId,
    body.name,
    body.slug,
    userId,
    c.env,
  );
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result, 201);
});

// Shared logic — used by both the REST route and the MCP `update_environment` tool.
export async function updateEnvironmentData(
  envId: string,
  patchInput: { name?: string; display_order?: number },
  userId: string,
  env: Env,
): Promise<{ error: string; status: 400 | 404 | 502 } | EnvironmentRow> {
  if (!isUUID(envId)) return { error: "Invalid environment id", status: 400 };

  const envRow = await assertEnvOwner(env, envId, userId);
  if (!envRow) return { error: "Not found", status: 404 };

  const patch: Record<string, unknown> = {};

  if (patchInput.name !== undefined) {
    const name = patchInput.name.trim();
    if (!name || name.length > 64)
      return { error: "name must be 1-64 chars", status: 400 };
    patch.name = name;
  }
  if (patchInput.display_order !== undefined) {
    if (
      !Number.isInteger(patchInput.display_order) ||
      patchInput.display_order < 0
    )
      return {
        error: "display_order must be a non-negative integer",
        status: 400,
      };
    patch.display_order = patchInput.display_order;
  }

  if (Object.keys(patch).length === 0)
    return { error: "Nothing to update", status: 400 };

  // project_environments has no user_id column — it's scoped via the parent
  // project (envRow.project_id, already verified above by assertEnvOwner).
  let res: Response;
  try {
    res = await scopedByProject(env, userId, envRow.project_id, "project_environments", {
      query: `id=eq.${envId}`,
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: patch,
    });
  } catch (e) {
    if (!(e instanceof NotOwnedError)) throw e;
    // unreachable in practice — envRow.project_id already verified above.
    return { error: "Failed to update environment", status: 502 };
  }
  if (!res.ok) return { error: "Failed to update environment", status: 502 };

  const rows = (await res.json()) as EnvironmentRow[];
  auditLog(env, userId, "environment_updated", {
    environmentId: envId,
    projectId: envRow.project_id,
    changes: patch,
  });
  return rows[0];
}

// ── PATCH /api/environments/:projectId/:envId ────────────────
environmentsRouter.patch("/:projectId/:envId", async (c) => {
  const userId = c.get("userId");
  const envId = c.req.param("envId");
  const body = await c.req.json<{ name?: string; display_order?: number }>();
  const result = await updateEnvironmentData(envId, body, userId, c.env);
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

// Shared logic — used by both the REST route and the MCP `delete_environment` tool.
export async function deleteEnvironmentData(
  envId: string,
  userId: string,
  env: Env,
): Promise<{ error: string; status: 400 | 404 | 502 } | { ok: true }> {
  if (!isUUID(envId)) return { error: "Invalid environment id", status: 400 };

  const envRow = await assertEnvOwner(env, envId, userId);
  if (!envRow) return { error: "Not found", status: 404 };

  if (envRow.is_default)
    return { error: "Cannot delete the default environment", status: 400 };

  // Block if any node in this env is provisioned
  let stateRes: Response;
  try {
    stateRes = await scopedByEnv(env, userId, envId, "project_env_node_state", {
      query: `select=node_id,state`,
    });
  } catch (e) {
    if (!(e instanceof NotOwnedError)) throw e;
    // unreachable in practice — envId already verified above.
    return { error: "Failed to check environment state", status: 502 };
  }
  if (!stateRes.ok)
    return { error: "Failed to check environment state", status: 502 };
  const stateRows = (await stateRes.json()) as Array<{
    node_id: string;
    state: { status?: string };
  }>;
  const provisioned = stateRows.filter(
    (r) => r.state?.status === "provisioned",
  );
  if (provisioned.length > 0) {
    return {
      error: `Cannot delete — ${provisioned.length} node(s) have cloud resources in this environment. Deprovision them first.`,
      status: 400,
    };
  }

  // project_environments has no user_id column — it's scoped via the parent
  // project (envRow.project_id, already verified above by assertEnvOwner).
  let res: Response;
  try {
    res = await scopedByProject(env, userId, envRow.project_id, "project_environments", {
      query: `id=eq.${envId}`,
      method: "DELETE",
    });
  } catch (e) {
    if (!(e instanceof NotOwnedError)) throw e;
    // unreachable in practice — envRow.project_id already verified above.
    return { error: "Failed to delete environment", status: 502 };
  }
  if (!res.ok) return { error: "Failed to delete environment", status: 502 };
  auditLog(env, userId, "environment_deleted", {
    environmentId: envId,
    projectId: envRow.project_id,
    name: envRow.name,
  });
  return { ok: true };
}

// ── DELETE /api/environments/:projectId/:envId ───────────────
environmentsRouter.delete("/:projectId/:envId", async (c) => {
  const userId = c.get("userId");
  const envId = c.req.param("envId");
  const result = await deleteEnvironmentData(envId, userId, c.env);
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

// ── GET /api/environments/:projectId/:envId/node-state ───────
environmentsRouter.get("/:projectId/:envId/node-state", async (c) => {
  const userId = c.get("userId");
  const envId = c.req.param("envId");
  if (!isUUID(envId)) return c.json({ error: "Invalid environment id" }, 400);

  if (!(await assertEnvOwner(c.env, envId, userId)))
    return c.json({ error: "Not found" }, 404);

  const state = await getAllEnvNodeState(c.env, envId);
  return c.json(state);
});

// Shared logic — used by both the REST route and the MCP `get_environment_secrets` tool.
// Returns key names + metadata only — values are NEVER decrypted or returned here.
export async function getEnvironmentSecretsData(
  envId: string,
  userId: string,
  env: Env,
): Promise<
  | { error: string; status: 400 | 404 | 502 }
  | Array<{ node_id: string; env_var_key: string; updated_at: string }>
> {
  if (!isUUID(envId)) return { error: "Invalid environment id", status: 400 };

  let res: Response;
  try {
    res = await scopedByEnv(env, userId, envId, "project_env_secret_overrides", {
      query: `select=node_id,env_var_key,updated_at&order=node_id.asc,env_var_key.asc`,
    });
  } catch (e) {
    if (e instanceof NotOwnedError) return { error: "Not found", status: 404 };
    throw e;
  }
  if (!res.ok) return { error: "Failed to fetch secrets", status: 502 };

  return (await res.json()) as Array<{
    node_id: string;
    env_var_key: string;
    updated_at: string;
  }>;
}

// ── GET /api/environments/:projectId/:envId/secrets ──────────
// Returns key names only — values are never returned
environmentsRouter.get("/:projectId/:envId/secrets", async (c) => {
  const userId = c.get("userId");
  const envId = c.req.param("envId");
  const result = await getEnvironmentSecretsData(envId, userId, c.env);
  if (!Array.isArray(result) && "error" in result)
    return c.json({ error: result.error }, result.status);
  return c.json(result);
});

// Shared logic — used by both the REST route and the MCP `set_environment_secrets` tool.
export async function setEnvironmentSecretData(
  envId: string,
  nodeIdInput: string | undefined,
  keyInput: string | undefined,
  value: string | undefined | null,
  userId: string,
  env: Env,
): Promise<{ error: string; status: 400 | 404 } | { ok: true }> {
  if (!isUUID(envId)) return { error: "Invalid environment id", status: 400 };

  const envRow = await assertEnvOwner(env, envId, userId);
  if (!envRow) return { error: "Not found", status: 404 };

  const nodeId = nodeIdInput?.trim();
  const key = keyInput?.trim();

  if (!nodeId || nodeId.length > 256)
    return { error: "nodeId required (max 256 chars)", status: 400 };
  if (!key || key.length > 256)
    return { error: "key required (max 256 chars)", status: 400 };
  if (value === undefined || value === null)
    return { error: "value required", status: 400 };
  if (typeof value !== "string" || value.length > 32768)
    return { error: "value must be a string (max 32768 chars)", status: 400 };

  await upsertEnvSecret(env, envId, nodeId, key, value);
  // Never include `value` here — audit trail records that a secret was set, not what it was set to.
  auditLog(env, userId, "environment_secret_set", {
    environmentId: envId,
    projectId: envRow.project_id,
    nodeId,
    key,
  });
  return { ok: true };
}

// ── PUT /api/environments/:projectId/:envId/secrets ──────────
environmentsRouter.put("/:projectId/:envId/secrets", async (c) => {
  const userId = c.get("userId");
  const envId = c.req.param("envId");
  const body = await c.req.json<{
    nodeId?: string;
    key?: string;
    value?: string;
  }>();
  const result = await setEnvironmentSecretData(
    envId,
    body.nodeId,
    body.key,
    body.value,
    userId,
    c.env,
  );
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

// Shared logic — used by both the REST route and the MCP `delete_environment_secret` tool.
export async function deleteEnvironmentSecretData(
  envId: string,
  nodeId: string,
  key: string,
  userId: string,
  env: Env,
): Promise<{ error: string; status: 400 | 404 } | { ok: true }> {
  if (!isUUID(envId)) return { error: "Invalid environment id", status: 400 };

  const envRow = await assertEnvOwner(env, envId, userId);
  if (!envRow) return { error: "Not found", status: 404 };

  await deleteEnvSecret(env, envId, nodeId, key);
  auditLog(env, userId, "environment_secret_deleted", {
    environmentId: envId,
    projectId: envRow.project_id,
    nodeId,
    key,
  });
  return { ok: true };
}

// ── DELETE /api/environments/:projectId/:envId/secrets/:nodeId/:key ─
environmentsRouter.delete(
  "/:projectId/:envId/secrets/:nodeId/:key",
  async (c) => {
    const userId = c.get("userId");
    const envId = c.req.param("envId");
    const nodeId = c.req.param("nodeId");
    const key = c.req.param("key");
    const result = await deleteEnvironmentSecretData(
      envId,
      nodeId,
      key,
      userId,
      c.env,
    );
    if ("error" in result)
      return c.json({ error: result.error }, result.status);
    return c.json(result);
  },
);

// Shared logic — used by both the REST route and the MCP `promote_environment` tool.
// Copies config (NOT resource IDs) from source env to the default env.
// User must then manually deploy the default env.
export async function promoteEnvironmentData(
  projectId: string,
  envId: string,
  userId: string,
  env: Env,
): Promise<
  { error: string; status: 400 | 404 | 502 } | { ok: true; copied: number }
> {
  if (!isUUID(projectId)) return { error: "Invalid project id", status: 400 };
  if (!isUUID(envId)) return { error: "Invalid environment id", status: 400 };

  const srcEnv = await assertEnvOwner(env, envId, userId);
  if (!srcEnv) return { error: "Not found", status: 404 };
  if (srcEnv.project_id !== projectId)
    return { error: "Not found", status: 404 };
  if (srcEnv.is_default)
    return {
      error: "Cannot promote the default environment to itself",
      status: 400,
    };

  // srcEnv.project_id === projectId (checked above), so ownership of
  // projectId is already transitively established here.
  let defaultRes: Response;
  try {
    defaultRes = await scopedByProject(env, userId, projectId, "project_environments", {
      query: `is_default=eq.true&select=id&limit=1`,
    });
  } catch (e) {
    if (e instanceof NotOwnedError)
      return { error: "No default environment found", status: 404 };
    throw e;
  }
  const defaultRows = (await defaultRes.json()) as Array<{ id: string }>;
  if (!defaultRows.length)
    return { error: "No default environment found", status: 404 };
  const defaultEnvId = defaultRows[0].id;

  // Fetch node state from source env
  let stateRes: Response;
  try {
    stateRes = await scopedByEnv(env, userId, envId, "project_env_node_state", {
      query: `select=node_id,state`,
    });
  } catch (e) {
    if (e instanceof NotOwnedError)
      return { error: "Failed to read source state", status: 502 };
    throw e;
  }
  if (!stateRes.ok)
    return { error: "Failed to read source state", status: 502 };
  const stateRows = (await stateRes.json()) as Array<{
    node_id: string;
    state: Record<string, unknown>;
  }>;

  if (stateRows.length === 0) return { ok: true, copied: 0 };

  // Copy only config fields — not resource IDs or status (those belong to the target env)
  const CONFIG_FIELDS = new Set([
    "customEnvVars",
    "cfWorkerEnvVars",
    "projectName",
    "region",
    "fromEmail",
    "senderName",
    "cfLocationHint",
    "compatibilityDate",
  ]);

  const upsertRows = stateRows
    .map((r) => {
      const configOnly: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r.state)) {
        if (CONFIG_FIELDS.has(k)) configOnly[k] = v;
      }
      return Object.keys(configOnly).length > 0
        ? {
            environment_id: defaultEnvId,
            node_id: r.node_id,
            state: configOnly,
          }
        : null;
    })
    .filter(Boolean);

  if (upsertRows.length === 0) return { ok: true, copied: 0 };

  let upsertRes: Response;
  try {
    upsertRes = await scopedByEnv(env, userId, defaultEnvId, "project_env_node_state", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: upsertRows,
    });
  } catch (e) {
    if (e instanceof NotOwnedError)
      return { error: "Failed to write to default environment", status: 502 };
    throw e;
  }
  if (!upsertRes.ok)
    return { error: "Failed to write to default environment", status: 502 };

  auditLog(env, userId, "environment_promoted", {
    projectId,
    sourceEnvironmentId: envId,
    targetEnvironmentId: defaultEnvId,
    copiedCount: upsertRows.length,
  });
  return { ok: true, copied: upsertRows.length };
}

// ── POST /api/environments/:projectId/:envId/promote ─────────
// Copies config (NOT resource IDs) from source env to the default env.
// User must then manually deploy the default env.
environmentsRouter.post("/:projectId/:envId/promote", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  const envId = c.req.param("envId");
  const result = await promoteEnvironmentData(projectId, envId, userId, c.env);
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

// Shared logic — used by both the REST route and the MCP `branch_environment` tool.
export async function branchEnvironmentData(
  projectId: string,
  envId: string,
  name: string | undefined,
  slug: string | undefined,
  userId: string,
  env: Env,
): Promise<
  { error: string; status: 400 | 404 | 409 | 429 | 502 } | EnvironmentRow
> {
  if (!isUUID(projectId) || !isUUID(envId))
    return { error: "Invalid id", status: 400 };

  const parent = await assertEnvOwner(env, envId, userId);
  if (!parent) return { error: "Not found", status: 404 };
  if (parent.project_id !== projectId)
    return { error: "Not found", status: 404 };

  if (!name || !slug) return { error: "name and slug required", status: 400 };
  if (!SLUG_RE.test(slug)) return { error: "Invalid slug", status: 400 };

  // ── Precondition 1: branch only from the default (trunk) environment ──────
  // Native branching maps a branch off a fully-provisioned trunk; branch-of-branch
  // is explicitly out of scope (spec §2) — the branch would have no real parent
  // resources to reference.
  if (!parent.is_default)
    return {
      error: "Branch can only be created from the default environment",
      status: 400,
    };

  // ── Precondition 2: the default env must be fully provisioned ─────────────
  // A branch derives its per-provider strategy (native vs isolated) from trunk's
  // live resources at deploy time; if trunk isn't fully up, there's nothing to
  // branch off. Config-only nodes (github/resend) count as provisioned via
  // 050_backfill_config_node_state.sql, so this reads uniformly from node state.
  // projectId's ownership was already verified above (parent.project_id === projectId).
  let canvasRes: Response;
  try {
    canvasRes = await scopedByProject(env, userId, projectId, "project_environments", {
      query: `id=eq.${envId}&select=canvas&limit=1`,
    });
  } catch (e) {
    if (e instanceof NotOwnedError) return { error: "Not found", status: 404 };
    throw e;
  }
  const canvasRows = (await canvasRes.json()) as Array<{ canvas: unknown }>;
  const parentCanvasRaw = (canvasRows[0]?.canvas ?? {
    nodes: [],
    edges: [],
  }) as {
    nodes?: Array<{
      id: string;
      type?: string;
      data?: { provider?: string };
    }>;
  };
  const serviceNodes = (parentCanvasRaw.nodes ?? []).filter(
    (n) => n.type === "service",
  );
  if (serviceNodes.length === 0)
    return {
      error: "The default environment has no services to branch",
      status: 400,
    };

  const nodeStates = await getAllEnvNodeState(env, envId);
  const unprovisioned = serviceNodes
    .filter((n) => nodeStates[n.id]?.status !== "provisioned")
    .map((n) => n.id);
  if (unprovisioned.length > 0)
    return {
      error:
        "Deploy the default environment before branching. Unprovisioned nodes: " +
        unprovisioned.join(", "),
      status: 400,
    };

  // Count existing envs
  let countRes: Response | undefined;
  try {
    countRes = await scopedByProject(env, userId, projectId, "project_environments", {
      query: `select=id`,
    });
  } catch (e) {
    if (!(e instanceof NotOwnedError)) throw e;
    // unreachable in practice — projectId ownership already verified above;
    // mirror the original code's lack of an explicit !countRes.ok check by
    // falling through with an empty existing-count array.
  }
  const existing = countRes ? ((await countRes.json()) as unknown[]) : [];
  if (existing.length >= 10)
    return { error: "Maximum 10 environments per project", status: 400 };

  // Copy trunk canvas, stripping all runtime state so the branch's nodes start
  // unprovisioned. Cloud resources are NOT touched here — the branch is
  // metadata-only; branchMode + branch refs are resolved at deploy time.
  const parentCanvas = stripResourceState(
    parentCanvasRaw ?? { nodes: [], edges: [] },
  );

  let insertRes: Response;
  try {
    insertRes = await scopedByProject(env, userId, projectId, "project_environments", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        project_id: projectId,
        name,
        slug,
        is_default: false,
        parent_id: envId,
        // branch_key = the stable git-ref key for this branch (spec §2). Distinct
        // from slug (renameable); fixed once resources are created against it.
        branch_key: slug,
        canvas: parentCanvas,
        display_order: existing.length,
      },
    });
  } catch (e) {
    if (!(e instanceof NotOwnedError)) throw e;
    return { error: "Failed to create environment", status: 502 };
  }
  if (!insertRes.ok) {
    const err = await insertRes.text();
    if (err.includes("Maximum of 10"))
      return {
        error: "Maximum of 10 environments allowed per project",
        status: 429,
      };
    if (err.includes("unique") || err.includes("duplicate"))
      return { error: `Slug "${slug}" already exists`, status: 409 };
    return { error: "Failed to create environment", status: 502 };
  }
  const rows = (await insertRes.json()) as EnvironmentRow[];
  const branchEnv = rows[0];

  // ── Secret seeding (audit gap #6) ─────────────────────────────────────────
  // Copy the trunk env's per-node secret overrides into the branch so the branch
  // deploys with the same secrets by default. Decrypt-then-re-encrypt via the
  // env helpers only — never touch value_encrypted directly. Non-fatal: a failure
  // here leaves the branch created but without seeded secrets (the user can
  // re-enter them), so we don't roll back the environment.
  try {
    const overrides = await collectAllOverridesForEnv(env, envId);
    await Promise.all(
      Object.entries(overrides).flatMap(([nodeId, kv]) =>
        Object.entries(kv).map(([key, value]) =>
          upsertEnvSecret(env, branchEnv.id, nodeId, key, value),
        ),
      ),
    );
  } catch {
    // Non-fatal — branch is usable; secrets can be re-entered per env.
  }

  // ── Config-only node state seeding ────────────────────────────────────────
  // github/resend nodes are never re-provisioned on deploy (buildProvisionPlan
  // skips them — they reference an existing repo / email config, not a new cloud
  // resource). Their "provisioned" status normally comes from import time, but
  // stripResourceState wiped it from the branch canvas. Without seeding, these
  // nodes would sit at "deploying" forever. Copy the trunk env's live state for
  // each config-only node so the branch shows them provisioned immediately
  // (they point at the SAME shared repo/config). Non-fatal.
  try {
    const configNodes = (parentCanvasRaw.nodes ?? []).filter((n) => {
      const p = n.data?.provider?.toLowerCase();
      return n.type === "service" && (p === "github" || p === "resend");
    });
    await Promise.all(
      configNodes.map((n) => {
        const trunkState = nodeStates[n.id];
        if (trunkState?.status !== "provisioned") return Promise.resolve();
        return setEnvNodeState(env, branchEnv.id, n.id, trunkState);
      }),
    );
  } catch {
    // Non-fatal — the node will still deploy; only its badge status lags.
  }

  auditLog(env, userId, "environment_branched", {
    projectId,
    parentEnvironmentId: envId,
    environmentId: branchEnv.id,
    name,
    slug,
  });
  return branchEnv;
}

// ── POST /api/environments/:projectId/:envId/branch — create child env ────
environmentsRouter.post("/:projectId/:envId/branch", async (c) => {
  const { projectId, envId } = c.req.param();
  const userId = c.get("userId");
  const { name, slug } = await c.req.json();
  const result = await branchEnvironmentData(
    projectId,
    envId,
    name,
    slug,
    userId,
    c.env,
  );
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result, 201);
});

// ── Per-env canvas ─────────────────────────────────────────────────────────

environmentsRouter.get("/:projectId/:envId/canvas", async (c) => {
  const { projectId, envId } = c.req.param();
  const userId = c.get("userId");
  if (!isUUID(projectId) || !isUUID(envId))
    return c.json({ error: "Invalid id" }, 400);

  let res: Response;
  try {
    res = await scopedByProject(c.env, userId, projectId, "project_environments", {
      query: `id=eq.${envId}&select=canvas,canvas_version&limit=1`,
    });
  } catch (e) {
    if (e instanceof NotOwnedError) return c.json({ error: "Not found" }, 404);
    throw e;
  }
  const rows = (await res.json()) as Array<{
    canvas: unknown;
    canvas_version: number;
  }>;
  if (!rows.length) return c.json({ error: "Environment not found" }, 404);
  const canvas = (rows[0].canvas ?? { nodes: [], edges: [] }) as Record<
    string,
    unknown
  >;
  return c.json({ ...canvas, canvas_version: rows[0].canvas_version ?? 0 });
});

environmentsRouter.put("/:projectId/:envId/canvas", async (c) => {
  const { projectId, envId } = c.req.param();
  const userId = c.get("userId");
  if (!isUUID(projectId) || !isUUID(envId))
    return c.json({ error: "Invalid id" }, 400);
  if (!(await assertWorkflowOwner(c.env, projectId, userId)))
    return c.json({ error: "Not found" }, 404);

  const body = await c.req.json();
  const parsed = CanvasSchema.safeParse({
    nodes: Array.isArray(body?.nodes) ? body.nodes : [],
    edges: Array.isArray(body?.edges) ? body.edges : [],
  });
  if (!parsed.success) {
    return c.json(
      { error: "Invalid canvas: " + parsed.error.issues[0]?.message },
      400,
    );
  }
  const stripped = stripRuntimeFromCanvas(parsed.data) as {
    nodes: unknown[];
    edges: unknown[];
  };
  const canvas = {
    nodes: stripped.nodes,
    edges: stripped.edges,
    ...(body?.viewport ? { viewport: body.viewport } : {}),
  };

  const expectedVersion =
    typeof body?.expectedVersion === "number" ? body.expectedVersion : null;

  if (expectedVersion !== null) {
    const result = await patchEnvCanvasWithVersion(
      c.env,
      envId,
      expectedVersion,
      () => canvas,
      projectId,
    );
    if (!result.ok && result.conflict) {
      const current = await loadEnvCanvasWithVersion(c.env, envId).catch(
        () => null,
      );
      return c.json(
        { error: "canvas_conflict", currentVersion: current?.version ?? null },
        409,
      );
    }
    if (!result.ok) return c.json({ error: "Failed to save canvas" }, 502);
  } else {
    // project_environments has no user_id column — scoped via the parent
    // project. Ownership of projectId was already verified above by the
    // standalone assertWorkflowOwner call — which MUST stay (do not remove
    // it as "redundant" with this scopedByProject call): the OCC branch above
    // calls patchEnvCanvasWithVersion/loadEnvCanvasWithVersion, and those
    // canvasVersion.ts helpers do NOT independently verify ownership (their
    // PATCH filters by id+project_id only, no user_id/assert — see their
    // docstrings), so they rely entirely on this route's own check having
    // already run. NotOwnedError here (legacy-path re-check) is therefore
    // unreachable in practice.
    let res: Response;
    try {
      res = await scopedByProject(c.env, userId, projectId, "project_environments", {
        query: `id=eq.${envId}`,
        method: "PATCH",
        headers: { Prefer: "return=representation,count=exact" },
        body: { canvas },
      });
    } catch (e) {
      if (!(e instanceof NotOwnedError)) throw e;
      return c.json({ error: "Environment not found or access denied" }, 404);
    }
    if (!res.ok) return c.json({ error: "Failed to save canvas" }, 502);
    const rows = (await res.json()) as unknown[];
    if (rows.length === 0)
      return c.json({ error: "Environment not found or access denied" }, 404);
  }

  return c.json({ ok: true });
});
