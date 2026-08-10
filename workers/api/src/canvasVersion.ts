/**
 * Optimistic concurrency control + provision lock helpers.
 *
 * Canvas writes use a version column incremented by the bump_canvas_version()
 * trigger whenever the canvas JSONB changes.  Callers pass the version they
 * last read; the PATCH filter `canvas_version=eq.<expected>` causes 0 rows
 * to be updated on a mismatch, which we surface as a 409 conflict.
 *
 * Lock helpers call the claim_canvas_lock / release_canvas_lock DB functions
 * so the claim is atomic (single UPDATE inside a PL/pgSQL function).
 */

import type { Env } from "./types";
import { setEnvNodeState } from "./envHelpers";
import { scopedQuery, scopedByStack, systemQuery } from "./tenancy";

type Canvas = Record<string, unknown>;

// ── projects ──────────────────────────────────────────────────────────────────

export async function loadCanvasWithVersion(
  env: Env,
  projectId: string,
): Promise<{ canvas: Canvas; version: number }> {
  // No userId in scope here — this is a shared read building block used by
  // both user-scoped callers (patchCanvasWithVersion, which re-scopes its own
  // PATCH by user_id) and service-role/provisioner callers
  // (patchWorkflowCanvasNodeVersioned, markConfigOnlyNodesProvisioned) that
  // run after ownership was already established upstream. systemQuery
  // preserves today's unscoped read exactly.
  const res = await systemQuery(
    env,
    `projects?id=eq.${projectId}&select=canvas,canvas_version&limit=1`,
  );
  if (!res.ok) throw new Error("Failed to load canvas");
  const rows = (await res.json()) as Array<{
    canvas: Canvas;
    canvas_version: number;
  }>;
  if (!rows[0]) throw new Error("Project not found");
  return { canvas: rows[0].canvas, version: rows[0].canvas_version };
}

/**
 * Atomically apply `mutator` to the canvas under optimistic concurrency.
 *
 * Passes `?canvas_version=eq.<expectedVersion>&user_id=eq.<userId>` so PostgREST
 * only updates the row when: (a) no concurrent write has happened, AND (b) the
 * caller owns the project.  Returns `{ conflict: true }` when 0 rows are
 * returned (version mismatch or wrong owner → indistinguishable on purpose).
 */
export async function patchCanvasWithVersion(
  env: Env,
  projectId: string,
  expectedVersion: number,
  mutator: (canvas: Canvas) => Canvas,
  userId: string,
): Promise<{ ok: boolean; conflict: boolean }> {
  // Load current canvas (we need it to apply the mutator)
  const { canvas } = await loadCanvasWithVersion(env, projectId);
  const updated = mutator(canvas);

  const res = await scopedQuery(env, userId, "projects", {
    method: "PATCH",
    query: `id=eq.${projectId}&canvas_version=eq.${expectedVersion}`,
    headers: { Prefer: "return=representation,count=exact" },
    body: { canvas: updated },
  });
  if (!res.ok) return { ok: false, conflict: false };

  const rows = (await res.json()) as unknown[];
  if (rows.length === 0) return { ok: false, conflict: true };
  return { ok: true, conflict: false };
}

// ── project_environments ──────────────────────────────────────────────────────

export async function loadEnvCanvasWithVersion(
  env: Env,
  environmentId: string,
): Promise<{ canvas: Canvas; version: number }> {
  // No userId parameter — callers (environments.ts PUT canvas route,
  // workflowProvision.ts) assert ownership before calling this. systemQuery
  // preserves the exact unscoped read; adding a filter here is the caller's
  // job, not this helper's (see patchEnvCanvasWithVersion below).
  const res = await systemQuery(
    env,
    `project_environments?id=eq.${environmentId}&select=canvas,canvas_version&limit=1`,
  );
  if (!res.ok) throw new Error("Failed to load env canvas");
  const rows = (await res.json()) as Array<{
    canvas: Canvas;
    canvas_version: number;
  }>;
  if (!rows[0]) throw new Error("Environment not found");
  return { canvas: rows[0].canvas, version: rows[0].canvas_version };
}

/**
 * Same OCC semantics as patchCanvasWithVersion but for project_environments.
 * Scopes the PATCH to `id AND project_id` so an attacker cannot patch an
 * environment that belongs to a different project (defense-in-depth on top of
 * the assertProjectOwner check in the route handler).
 */
export async function patchEnvCanvasWithVersion(
  env: Env,
  environmentId: string,
  expectedVersion: number,
  mutator: (canvas: Canvas) => Canvas,
  projectId: string,
): Promise<{ ok: boolean; conflict: boolean }> {
  const { canvas } = await loadEnvCanvasWithVersion(env, environmentId);
  const updated = mutator(canvas);

  // No userId parameter — the environments.ts PUT canvas route calls
  // assertProjectOwner before reaching this helper, exactly as documented
  // above. systemQuery preserves the id+project_id+version filter unchanged;
  // adding a user_id filter here (there is no userId in scope to add) would
  // require plumbing a new parameter through every caller, which is out of
  // this task's scope and risks changing OCC semantics if done carelessly.
  const res = await systemQuery(
    env,
    `project_environments?id=eq.${environmentId}&project_id=eq.${projectId}&canvas_version=eq.${expectedVersion}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation,count=exact" } as HeadersInit,
      body: JSON.stringify({ canvas: updated }),
    },
  );
  if (!res.ok) return { ok: false, conflict: false };

  const rows = (await res.json()) as unknown[];
  if (rows.length === 0) return { ok: false, conflict: true };
  return { ok: true, conflict: false };
}

/**
 * Applies `mutator` to an env canvas with retry-on-conflict, always re-fetching
 * the current version. Use this for mutations (e.g. node deletion) where the
 * caller does not hold a pre-read version and strict OCC is not required.
 * Retries once if a concurrent write races the PATCH.
 */
export async function patchEnvCanvasRetry(
  env: Env,
  environmentId: string,
  mutator: (canvas: Canvas) => Canvas,
  projectId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { canvas, version } = await loadEnvCanvasWithVersion(
      env,
      environmentId,
    );
    const updated = mutator(canvas);
    // No userId parameter (see loadEnvCanvasWithVersion/patchEnvCanvasWithVersion
    // above) — callers (workflowProvision.ts) assert ownership before calling
    // this. systemQuery preserves the exact id+project_id+version filter.
    const res = await systemQuery(
      env,
      `project_environments?id=eq.${environmentId}&project_id=eq.${projectId}&canvas_version=eq.${version}`,
      {
        method: "PATCH",
        headers: {
          Prefer: "return=representation,count=exact",
        } as HeadersInit,
        body: JSON.stringify({ canvas: updated }),
      },
    );
    if (!res.ok) throw new Error(`Failed to patch env canvas: ${res.status}`);
    const rows = (await res.json()) as unknown[];
    if (rows.length > 0) return; // success
    // conflict → retry once with re-fetched version
  }
  throw new Error(
    `env canvas patch conflict after 2 attempts: environmentId=${environmentId}`,
  );
}

// ── Lock helpers ──────────────────────────────────────────────────────────────

/** Throws if the canvas is locked by an active deployment (not the current user's own lock). */
export async function assertCanvasUnlocked(
  env: Env,
  projectId: string,
  userId: string,
): Promise<void> {
  const res = await scopedQuery(env, userId, "projects", {
    query: `id=eq.${projectId}&select=canvas_locked_by,canvas_locked_at&limit=1`,
  });
  if (!res.ok) return;
  const rows = (await res.json()) as Array<{
    canvas_locked_by: string | null;
    canvas_locked_at: string | null;
  }>;
  const row = rows[0];
  if (row?.canvas_locked_by && row.canvas_locked_by !== userId) {
    throw new Error(
      `Canvas is locked by an active deployment (since ${row.canvas_locked_at}). Wait for it to finish or force-unlock from the Leenar dashboard.`,
    );
  }
}

export async function claimLock(
  env: Env,
  projectId: string,
  userId: string,
  reason: "provisioning" | "deprovisioning" | "manual",
): Promise<{ ok: boolean; lockedBy?: string; lockedAt?: string }> {
  // RPC, not tenant-filterable via a PostgREST query filter.
  const res = await systemQuery(env, "rpc/claim_canvas_lock", {
    method: "POST",
    headers: { "Content-Type": "application/json" } as HeadersInit,
    body: JSON.stringify({
      p_project_id: projectId,
      p_user_id: userId,
      p_reason: reason,
    }),
  });
  if (!res.ok) return { ok: false };
  const data = (await res.json()) as {
    ok: boolean;
    lockedBy?: string;
    lockedAt?: string;
    error?: string;
  };
  return data;
}

/**
 * Clears the provision lock on a project.
 *
 * Pass `userId` whenever the caller knows the owner: migration 076 scopes the
 * UPDATE by it, so a wrong projectId can no longer clear a different tenant's
 * lock. Omitting it keeps the old unscoped behaviour, which the DO's
 * watchdog/recovery paths need — WatchdogState.userId is optional, and a lock
 * that cannot be released is worse than one released unscoped (the project
 * stays stuck until the 12-minute force-unlock).
 *
 * p_user_id is omitted rather than sent as null when unknown, so this still
 * resolves against a database that has not taken 076 yet.
 */
export async function releaseLock(
  env: Env,
  projectId: string,
  userId?: string,
): Promise<void> {
  // RPC, not tenant-filterable via a PostgREST query filter.
  await systemQuery(env, "rpc/release_canvas_lock", {
    method: "POST",
    headers: { "Content-Type": "application/json" } as HeadersInit,
    body: JSON.stringify(
      userId
        ? { p_project_id: projectId, p_user_id: userId }
        : { p_project_id: projectId },
    ),
  }).catch(() => {});
}

/**
 * Force-unlock a stuck provision lock.
 * Requirements: caller must be the project owner, lock must be > 12 minutes old.
 * Marks any running provisioning_sessions for this project as failed.
 */
export async function forceUnlock(
  env: Env,
  projectId: string,
  userId: string,
): Promise<{ ok: boolean; code?: string; error?: string }> {
  // Fetch current lock state + ownership
  const wfRes = await scopedQuery(env, userId, "projects", {
    query: `id=eq.${projectId}&select=id,canvas_locked_at,canvas_locked_by&limit=1`,
  });
  if (!wfRes.ok) return { ok: false, error: "Failed to read project" };
  const rows = (await wfRes.json()) as Array<{
    id: string;
    canvas_locked_at: string | null;
    canvas_locked_by: string | null;
  }>;
  if (!rows[0]) return { ok: false, error: "Not found or not owner" };

  const { canvas_locked_at } = rows[0];
  if (!canvas_locked_at) return { ok: false, error: "Not locked" };

  const ageMs = Date.now() - new Date(canvas_locked_at).getTime();
  // Must exceed the DO's own budget (10 min) + stuck buffer (2 min) so a slow
  // but healthy deploy can't be force-unlocked out from under a running DO.
  const FORCE_UNLOCK_MIN_AGE_MS = 12 * 60 * 1000;
  if (ageMs < FORCE_UNLOCK_MIN_AGE_MS) {
    return {
      ok: false,
      code: "too_recent",
      error: "Lock is less than 12 minutes old",
    };
  }

  // Mark any running sessions for this project as failed.
  // Project ownership was already established above (scopedQuery on
  // `projects` returned a row); scoping this `stacks` list by user_id too is
  // net hardening — it doesn't change which stacks match for the legitimate
  // owner, since every stack under an owned project belongs to that owner.
  const stacksRes = await scopedQuery(env, userId, "stacks", {
    query: `project_id=eq.${projectId}&status=eq.provisioning&select=id`,
  });
  if (stacksRes.ok) {
    const stacks = (await stacksRes.json()) as Array<{ id: string }>;
    for (const stack of stacks) {
      // provisioning_sessions has no user_id column; scopedByStack re-asserts
      // stack ownership (already established via the owner-scoped `stacks`
      // list above) before issuing the child PATCH. The trailing .catch(() =>
      // {}) — unchanged from before this migration — swallows both HTTP
      // failures and a (here-unreachable) NotOwnedError identically.
      await scopedByStack(env, userId, stack.id, "provisioning_sessions", {
        method: "PATCH",
        query: `status=eq.running`,
        headers: { Prefer: "return=minimal" },
        body: {
          status: "failed",
          error_message: "Force-unlocked by project owner",
        },
      }).catch(() => {});
      await scopedQuery(env, userId, "stacks", {
        method: "PATCH",
        query: `id=eq.${stack.id}`,
        headers: { Prefer: "return=minimal" },
        body: { status: "error" },
      }).catch(() => {});
    }
  }

  await releaseLock(env, projectId, userId);
  return { ok: true };
}

/**
 * Internal version-aware node patch used by the provisioner (service-role context).
 * Uses `id=eq.` without a user_id filter because the provisioner runs with the
 * Supabase service-role key and is already authenticated at a higher level
 * (projectId is derived from the stack row created at deploy-time by the owner).
 * Retries once on conflict (another writer updated the canvas concurrently).
 */
export async function patchWorkflowCanvasNodeVersioned(
  env: Env,
  projectId: string,
  nodeId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { canvas, version } = await loadCanvasWithVersion(env, projectId);
    const nodes =
      (canvas.nodes as Array<Record<string, unknown>> | undefined) ?? [];
    const updatedNodes = nodes.map((n) =>
      n.id === nodeId ? { ...n, data: { ...(n.data as object), ...patch } } : n,
    );
    // Use service-role-scoped PATCH (no user_id filter — intentional, see
    // docstring above: this function has no userId parameter, called from
    // provisioner.do.ts under service-role auth after ownership was already
    // established at deploy time). systemQuery preserves that behavior exactly.
    const res = await systemQuery(
      env,
      `projects?id=eq.${projectId}&canvas_version=eq.${version}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation,count=exact" } as HeadersInit,
        body: JSON.stringify({ canvas: { ...canvas, nodes: updatedNodes } }),
      },
    );
    if (!res.ok) throw new Error(`canvas node patch failed: ${res.status}`);
    const rows = (await res.json()) as unknown[];
    if (rows.length > 0) return; // success
    // conflict → retry once with re-fetched version
  }
  throw new Error(`canvas node patch conflict after 2 attempts: projectId=${projectId}, nodeId=${nodeId}`);
}

/**
 * Mark all config-only nodes (github, resend) on the project canvas as "provisioned"
 * so that they reflect a completed state and don't block subsequent deploys.
 */
export async function markConfigOnlyNodesProvisioned(
  env: Env,
  projectId: string,
  environmentId?: string | null,
): Promise<void> {
  const CONFIG_ONLY_PROVIDERS = new Set(["github", "resend"]);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { canvas, version } = await loadCanvasWithVersion(env, projectId);
      const nodes =
        (canvas.nodes as Array<Record<string, unknown>> | undefined) ?? [];

      const configNodeIds: string[] = [];
      let modified = false;
      const updatedNodes = nodes.map((n) => {
        const provider = (n.data as Record<string, unknown>)?.provider as
          | string
          | undefined;
        if (provider && CONFIG_ONLY_PROVIDERS.has(provider.toLowerCase())) {
          if (typeof n.id === "string") configNodeIds.push(n.id);
          if ((n.data as Record<string, unknown>)?.status !== "provisioned") {
            modified = true;
            return {
              ...n,
              data: {
                ...(n.data as object),
                status: "provisioned",
                provisionedAt: new Date().toISOString(),
              },
            };
          }
        }
        return n;
      });

      // The env-aware canvas renders provisioned status from project_env_node_state,
      // so config-only nodes (which have no provision step) must have their status
      // mirrored there too — otherwise they revert to unprovisioned on reload.
      // setEnvNodeState upserts (merge-duplicates), so repeats on retry are safe.
      if (environmentId && configNodeIds.length > 0) {
        for (const nodeId of configNodeIds) {
          await setEnvNodeState(env, environmentId, nodeId, {
            status: "provisioned",
            provisionedAt: new Date().toISOString(),
          }).catch(() => {});
        }
      }

      if (!modified) return; // Nothing to change

      // markConfigOnlyNodesProvisioned takes no userId — called from
      // provisioner.do.ts (service-role) and workflowProvision.ts's post-deploy
      // step, both after ownership was already established. Same rationale as
      // patchWorkflowCanvasNodeVersioned above: systemQuery preserves the
      // existing unscoped id+canvas_version PATCH exactly.
      const res = await systemQuery(
        env,
        `projects?id=eq.${projectId}&canvas_version=eq.${version}`,
        {
          method: "PATCH",
          headers: {
            Prefer: "return=representation,count=exact",
          } as HeadersInit,
          body: JSON.stringify({ canvas: { ...canvas, nodes: updatedNodes } }),
        },
      );
      if (!res.ok) return;
      const rows = (await res.json()) as unknown[];
      if (rows.length > 0) return; // success
    } catch {
      // ignore and retry
    }
  }
}
