import type { Env } from "./types";
import { getUserToken } from "./utils";
import { systemQuery } from "./tenancy";
import { claimLock, releaseLock, loadCanvasWithVersion, patchCanvasWithVersion } from "./canvasVersion";
import { getDefaultEnvironmentId } from "./envHelpers";
import { promoteVercelDeployment } from "./connectors/vercel";
import {
  getAccountId,
  rollbackCloudflareWorker,
} from "./connectors/cloudflare";

export type NodeRevertResult = {
  nodeId: string;
  service: string;
  action: "reverted" | "canvas_only" | "failed" | "not_supported";
  detail?: string;
};

export interface RollbackResult {
  ok: boolean;
  /** Structured reason for non-ok results — used by route for HTTP status mapping. */
  reason?: "locked" | "not_found" | "partial";
  canvasRestored: boolean;
  results: NodeRevertResult[];
  warnings?: string[];
}

export async function buildRevertResult(
  nodeId: string,
  ref: Record<string, any>,
  deps: { env: Env; userId: string },
): Promise<NodeRevertResult> {
  const service: string = ref.service ?? "unknown";

  if (service === "vercel" && ref.deploymentId && ref.projectId) {
    let token: string;
    try {
      token = await getUserToken(deps.env, deps.userId, "vercel");
    } catch {
      return { nodeId, service, action: "canvas_only", detail: "no vercel token" };
    }
    const r = await promoteVercelDeployment(token, ref.projectId, ref.deploymentId);
    return r.ok
      ? { nodeId, service, action: "reverted" }
      : { nodeId, service, action: "failed", detail: r.error };
  }

  if (service === "cloudflare-workers" && ref.versionId && ref.workerName) {
    let token: string;
    let accountId: string;
    try {
      token = await getUserToken(deps.env, deps.userId, "cloudflare");
      accountId = await getAccountId(token);
    } catch {
      return { nodeId, service, action: "canvas_only", detail: "no cloudflare token" };
    }
    const r = await rollbackCloudflareWorker(token, accountId, ref.workerName, ref.versionId);
    return r.ok
      ? { nodeId, service, action: "reverted" }
      : { nodeId, service, action: "failed", detail: r.error };
  }

  if (service === "supabase") {
    return {
      nodeId,
      service,
      action: "not_supported",
      detail: "Database is not rolled back automatically",
    };
  }

  if (service === "github" || service === "cloudflare-r2") {
    return {
      nodeId,
      service,
      action: "not_supported",
      detail: "Provider revert not supported; canvas restored only",
    };
  }

  return { nodeId, service, action: "canvas_only" };
}

/**
 * Execute a deployment rollback: canvas restore + env state restore + cloud revert.
 * Does NOT perform ownership checks — caller is responsible.
 * Does NOT call auditLog — caller logs with its own source.
 * Never throws — returns RollbackResult with ok: false on any failure.
 */
export async function executeRollback(
  env: Env,
  projectId: string,
  deploymentId: string,
  userId: string,
): Promise<RollbackResult> {
  // 1. Load deployment row — only success deployments are rollback candidates
  const depRes = await systemQuery(
    env,
    `project_deployments?id=eq.${deploymentId}&project_id=eq.${projectId}&status=eq.success&select=canvas_snapshot,provider_refs,env_node_state_snapshot,environment_id&limit=1`,
  );
  if (!depRes.ok) {
    return { ok: false, reason: "not_found", canvasRestored: false, results: [], warnings: ["failed to load deployment"] };
  }
  const depRows = await depRes.json<any[]>();
  if (!depRows.length) {
    return { ok: false, reason: "not_found", canvasRestored: false, results: [], warnings: ["deployment not found or not successful"] };
  }
  const {
    canvas_snapshot,
    provider_refs,
    env_node_state_snapshot: envSnap,
    environment_id: depEnvId,
  } = depRows[0];

  let environmentId: string | null = depEnvId ?? null;
  if (!environmentId) {
    try {
      environmentId = await getDefaultEnvironmentId(env, projectId);
    } catch {
      environmentId = null;
    }
  }

  // 2. Claim canvas lock — treat explicit false as locked; undefined (empty RPC body) as ok
  const lockResult = await claimLock(env, projectId, userId, "manual");
  if (lockResult.ok === false) {
    return { ok: false, reason: "locked", canvasRestored: false, results: [], warnings: ["canvas locked (deploy in progress)"] };
  }

  const warnings: string[] = [];
  let canvasRestored = false;
  let results: NodeRevertResult[] = [];
  // Tracks failures that represent incomplete rollbacks and must trigger escalation.
  // Bookkeeping failures (e.g. status PATCH) and missing snapshots do not set this.
  let hasSubstantiveWarning = false;

  try {
    // 3. Canvas restore — versioned write so a concurrent DO node-patch doesn't win
    const snap = canvas_snapshot as { nodes?: unknown[] } | null;
    if (snap && Array.isArray(snap.nodes) && snap.nodes.length > 0) {
      try {
        const { version } = await loadCanvasWithVersion(env, projectId);
        const result = await patchCanvasWithVersion(env, projectId, version, () => snap as Record<string, unknown>, userId);
        canvasRestored = result.ok;
        if (!result.ok) { warnings.push(`canvas restore failed (conflict or error)`); hasSubstantiveWarning = true; }
      } catch (e) {
        warnings.push(`canvas restore PATCH failed: ${e instanceof Error ? e.message : String(e)}`);
        hasSubstantiveWarning = true;
      }
    } else {
      warnings.push("canvas_snapshot empty — canvas not restored");
      hasSubstantiveWarning = true;
    }

    // 4. Env state restore — full replacement per node
    const envSnapObj =
      envSnap && typeof envSnap === "object"
        ? (envSnap as Record<string, unknown>)
        : {};
    if (environmentId && Object.keys(envSnapObj).length > 0) {
      for (const [nodeId, state] of Object.entries(envSnapObj)) {
        const r = await systemQuery(env, "project_env_node_state", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates" } as HeadersInit,
          body: JSON.stringify({
            environment_id: environmentId,
            node_id: nodeId,
            state,
            updated_at: new Date().toISOString(),
          }),
        });
        if (!r.ok) {
          warnings.push(`env_state restore failed for ${nodeId}: ${r.status}`);
          hasSubstantiveWarning = true;
        }
      }
    } else if (!environmentId) {
      // Pre-environment deployment — no env state to restore, this is expected
      warnings.push("no environmentId — env state skipped (deployment predates environment support)");
      // hasSubstantiveWarning stays false — not a real failure
    } else {
      warnings.push("no env_node_state_snapshot — env state not restored");
      hasSubstantiveWarning = true;
    }

    // 5. Cloud reverts — parallel, never rejects
    const refs = Object.entries(
      (provider_refs ?? {}) as Record<string, any>,
    );
    results = await Promise.all(
      refs.map(([nodeId, ref]) =>
        buildRevertResult(nodeId, ref, { env, userId }).catch((e) => ({
          nodeId,
          service: (ref as Record<string, unknown>).service as string ?? "unknown",
          action: "failed" as const,
          detail: String(e),
        })),
      ),
    );
    // 6. Mark deployment as rolled_back before releasing lock to prevent concurrent deploys
    const statusPatch = await systemQuery(
      env,
      `project_deployments?id=eq.${deploymentId}&project_id=eq.${projectId}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" } as HeadersInit,
        body: JSON.stringify({ status: "rolled_back" }),
      },
    );
    if (!statusPatch.ok)
      warnings.push(`status PATCH failed: ${statusPatch.status}`);
  } finally {
    await releaseLock(env, projectId, userId);
  }

  const hasFailure = results.some((r) => r.action === "failed");
  // ok=false triggers escalation in incidentMonitor. Cloud failures and canvas/env
  // restore failures are substantive; status PATCH failure is bookkeeping-only.
  return {
    ok: !hasFailure && !hasSubstantiveWarning,
    ...(warnings.length > 0 || hasFailure ? { reason: "partial" } : {}),
    canvasRestored,
    results,
    ...(warnings.length ? { warnings } : {}),
  };
}
