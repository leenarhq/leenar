/**
 * Read-only evidence collectors shared by the MCP tool layer (`routes/mcp.ts`)
 * and the insight tools under `insights/`.
 *
 * These live here rather than in `routes/mcp.ts` so that insight tools can reuse
 * them without importing the router — `routes/mcp.ts` imports the insight tools,
 * so the reverse edge would be a cycle.
 */
import type { Env } from "../types";
import { isUUID, makeTokenCache } from "../utils";
import type { CanvasNode, CanvasEdge } from "../routes/workflowProvision";
import { assertEnvOwner } from "../routes/environments";
import { getAllEnvNodeState, type EnvNodeState } from "../envHelpers";
import { decrypt } from "../crypto";
import { fingerprint } from "./envValue";
import {
  scopedQuery,
  scopedByProject,
  scopedByEnv,
  scopedByStack,
  systemQuery,
  NotOwnedError,
} from "../tenancy";

export async function getDrifts(projectId: string, userId: string, env: Env) {
  if (!isUUID(projectId)) throw new Error("Invalid project_id");
  const res = await scopedQuery(env, userId, "stack_drifts", {
    query: `project_id=eq.${projectId}&resolved_at=is.null&select=id,node_id,service,drift_type,field,expected,actual,detected_at&order=detected_at.desc`,
  });
  if (!res.ok) throw new Error("Failed to fetch drifts");
  const rows = (await res.json()) as unknown[];
  return { count: rows.length, drifts: rows };
}

export async function getIncidents(projectId: string, userId: string, env: Env) {
  if (!isUUID(projectId)) throw new Error("Invalid project_id");
  const res = await scopedQuery(env, userId, "incidents", {
    query: `project_id=eq.${projectId}&status=eq.open&select=id,service,severity,path,log_snippet,count,first_seen_at,last_seen_at&order=last_seen_at.desc`,
  });
  if (!res.ok) throw new Error("Failed to fetch incidents");
  const rows = (await res.json()) as unknown[];
  return { count: rows.length, incidents: rows };
}

export async function getDeploymentLogs(
  projectId: string,
  sessionId: string | undefined,
  userId: string,
  env: Env,
) {
  if (!isUUID(projectId)) throw new Error("Invalid project_id");
  if (sessionId && !isUUID(sessionId)) throw new Error("Invalid session_id");

  // Find latest stack for this workflow
  const stackRes = await scopedQuery(env, userId, "stacks", {
    query: `project_id=eq.${projectId}&order=created_at.desc&limit=1&select=id,name,status`,
  });
  if (!stackRes.ok) throw new Error("Failed to fetch stack");
  const [stack] = (await stackRes.json()) as Array<{
    id: string;
    name: string;
    status: string;
  }>;
  if (!stack) throw new Error("No deployments found for this workflow");

  // Resolve session: if session_id provided, validate ownership; otherwise fetch latest
  let session:
    | {
        id: string;
        status: string;
        steps: unknown[];
        total_steps: number;
        current_step: number | null;
        started_at: string;
        finished_at: string | null;
        error_message: string | null;
      }
    | undefined;

  // stack.id was just resolved from a userId-scoped `stacks` query above, so
  // NotOwnedError here can only mean a same-request race (stack deleted/
  // reassigned mid-flight) — map it to the same failure the old unscoped
  // query would have produced (session not found).
  if (sessionId) {
    let sessionRes: Response;
    try {
      sessionRes = await scopedByStack(env, userId, stack.id, "provisioning_sessions", {
        query: `id=eq.${sessionId}&limit=1&select=id,status,steps,total_steps,current_step,started_at,finished_at,error_message`,
      });
    } catch (e) {
      if (e instanceof NotOwnedError) throw new Error("Failed to fetch deployment session");
      throw e;
    }
    if (!sessionRes.ok) throw new Error("Failed to fetch deployment session");
    const rows = (await sessionRes.json()) as (typeof session)[];
    session = rows[0];
    if (!session)
      throw new Error("Session not found or does not belong to this workflow");
  } else {
    let sessionRes: Response;
    try {
      sessionRes = await scopedByStack(env, userId, stack.id, "provisioning_sessions", {
        query: `order=started_at.desc&limit=1&select=id,status,steps,total_steps,current_step,started_at,finished_at,error_message`,
      });
    } catch (e) {
      if (e instanceof NotOwnedError) throw new Error("Failed to fetch deployment logs");
      throw e;
    }
    if (!sessionRes.ok) throw new Error("Failed to fetch deployment logs");
    const rows = (await sessionRes.json()) as (typeof session)[];
    session = rows[0];
    if (!session) throw new Error("No session logs found for this deployment");
  }

  // deployment_logs/provisioning_events are keyed by session_id, a table two
  // hops from the user (session -> stack -> user) with no direct tenancy
  // helper for that shape. Ownership of `session` is already fully verified
  // above via scopedByStack — this fetch is safe-by-construction.
  const logsRes = await systemQuery(
    env,
    `deployment_logs?session_id=eq.${session.id}&order=created_at.asc&limit=50&select=level,service,message,created_at`,
  );
  const logs = logsRes.ok
    ? ((await logsRes.json()) as Array<{
        level: string;
        service: string;
        message: string;
        created_at: string;
      }>)
    : [];

  // Fetch last 20 provisioning events — silently skip if table missing or query fails
  let events: Array<{ type: string; payload: unknown; created_at: string }> =
    [];
  try {
    const eventsRes = await systemQuery(
      env,
      `provisioning_events?session_id=eq.${session.id}&order=sequence.asc&limit=20&select=type,payload,created_at`,
    );
    if (eventsRes.ok) {
      events = (await eventsRes.json()) as typeof events;
    }
  } catch {
    // provisioning_events may not exist for older sessions — ignore
  }

  return {
    stack_id: stack.id,
    stack_name: stack.name,
    stack_status: stack.status,
    session_id: session.id,
    session_status: session.status,
    current_step: session.current_step,
    total_steps: session.total_steps,
    started_at: session.started_at,
    finished_at: session.finished_at,
    error_message: session.error_message,
    steps: session.steps,
    logs,
    events,
  };
}

export async function getWorkflowEnvVars(
  projectId: string,
  userId: string,
  env: Env,
) {
  if (!isUUID(projectId)) throw new Error("Invalid project_id");

  const res = await scopedQuery(env, userId, "projects", {
    query: `id=eq.${projectId}&select=canvas&limit=1`,
  });
  if (!res.ok) throw new Error("Failed to fetch workflow");
  const rows = (await res.json()) as Array<{
    canvas: { nodes: CanvasNode[]; edges: CanvasEdge[] };
  }>;
  if (!rows.length) throw new Error("Workflow not found");

  const { nodes, edges } = rows[0].canvas;
  const nodeById = new Map((nodes ?? []).map((n) => [n.id, n]));

  const edgeSummaries = (edges ?? []).map((e) => {
    const src = nodeById.get(e.source);
    const tgt = nodeById.get(e.target);
    return {
      source_node_id: e.source,
      source_provider: String(src?.data.provider ?? "unknown"),
      target_node_id: e.target,
      target_provider: String(tgt?.data.provider ?? "unknown"),
      env_vars: ((e.data as any)?.envVars ?? []) as string[],
    };
  });

  const allEnvVars = Array.from(
    new Set(edgeSummaries.flatMap((e) => e.env_vars)),
  );

  return {
    project_id: projectId,
    edges: edgeSummaries,
    all_env_vars: allEnvVars,
    total: allEnvVars.length,
  };
}

export interface EnvironmentSnapshot {
  environment: {
    id: string;
    project_id: string;
    name: string;
    slug: string;
    is_default: boolean;
  };
  canvas: { nodes: CanvasNode[]; edges: CanvasEdge[] };
  node_state: Record<string, EnvNodeState>;
  /** node_id -> env_var_key -> keyed digest. Plaintext never leaves this function. */
  override_fingerprints: Record<string, Record<string, string>>;
}

/**
 * Everything `diff_environments` needs about one environment: its own canvas
 * (environments each carry a separate canvas), per-node provisioning state, and
 * its secret overrides reduced to comparison tokens.
 *
 * Overrides are decrypted here and fingerprinted before returning, so no caller
 * can leak a plaintext secret it never received. This is why the collector does
 * the fingerprinting rather than handing values to `diffEnvironments`.
 *
 * Throws when the environment does not exist or is not owned by `userId` —
 * the ownership check covers the parent project too (see routes/environments.ts).
 */
export async function getEnvironmentSnapshot(
  environmentId: string,
  userId: string,
  env: Env,
): Promise<EnvironmentSnapshot> {
  if (!isUUID(environmentId)) throw new Error("Invalid environment_id");

  const owned = await assertEnvOwner(env, environmentId, userId);
  if (!owned) throw new Error("Environment not found");

  // Ownership was just verified above via assertEnvOwner (id + parent-project
  // check) — this scopedByProject call re-asserts project ownership before the
  // fetch. NotOwnedError here is unreachable in practice (same-request race
  // only); map it to the same failure the old unscoped query would produce.
  let canvasRes: Response;
  try {
    canvasRes = await scopedByProject(env, userId, owned.project_id, "project_environments", {
      query: `id=eq.${environmentId}&select=canvas&limit=1`,
    });
  } catch (e) {
    if (e instanceof NotOwnedError) throw new Error("Failed to fetch environment canvas");
    throw e;
  }
  if (!canvasRes.ok) throw new Error("Failed to fetch environment canvas");
  const canvasRows = (await canvasRes.json()) as Array<{
    canvas: { nodes?: CanvasNode[]; edges?: CanvasEdge[] } | null;
  }>;

  const nodeState = await getAllEnvNodeState(env, environmentId);

  let overridesRes: Response;
  try {
    overridesRes = await scopedByEnv(env, userId, environmentId, "project_env_secret_overrides", {
      query: `select=node_id,env_var_key,value_encrypted`,
    });
  } catch (e) {
    if (e instanceof NotOwnedError) throw new Error("Failed to fetch secret overrides");
    throw e;
  }
  if (!overridesRes.ok) throw new Error("Failed to fetch secret overrides");
  const overrideRows = (await overridesRes.json()) as Array<{
    node_id: string;
    env_var_key: string;
    value_encrypted: string;
  }>;

  const overrideFingerprints: Record<string, Record<string, string>> = {};
  await Promise.all(
    overrideRows.map(async (row) => {
      const plain = await decrypt(row.value_encrypted, env.ENCRYPTION_KEY);
      const digest = await fingerprint(plain, env.ENCRYPTION_KEY);
      if (!overrideFingerprints[row.node_id])
        overrideFingerprints[row.node_id] = {};
      overrideFingerprints[row.node_id][row.env_var_key] = digest;
    }),
  );

  return {
    environment: {
      id: owned.id,
      project_id: owned.project_id,
      name: owned.name,
      slug: owned.slug,
      is_default: owned.is_default,
    },
    canvas: {
      nodes: canvasRows[0]?.canvas?.nodes ?? [],
      edges: canvasRows[0]?.canvas?.edges ?? [],
    },
    node_state: nodeState,
    override_fingerprints: overrideFingerprints,
  };
}

export async function resourceHealth(projectId: string, userId: string, env: Env) {
  if (!isUUID(projectId)) throw new Error("Invalid project_id");

  // Fetch canvas
  const projRes = await scopedQuery(env, userId, "projects", {
    query: `id=eq.${projectId}&select=canvas&limit=1`,
  });
  if (!projRes.ok) throw new Error("Failed to fetch project");
  const projRows = (await projRes.json()) as Array<{
    canvas: {
      nodes?: Array<{
        id: string;
        data?: Record<string, string>;
      }>;
    } | null;
  }>;
  if (!projRows.length) throw new Error("Project not found");

  const canvas = projRows[0].canvas;
  const allNodes = canvas?.nodes ?? [];

  // Only check provisioned nodes
  const provisionedNodes = allNodes.filter(
    (n) =>
      (n.data as Record<string, string> | undefined)?.status === "provisioned",
  );

  type HealthResult = {
    node_id: string;
    label: string;
    provider: string;
    resource_id: string | null;
    exists: boolean | null;
    error: string | null;
  };

  // Per-node health check — each wrapped in try/catch so one failure doesn't block others
  const getToken = makeTokenCache(env, userId);
  const checks: Promise<HealthResult>[] = provisionedNodes.map(async (node) => {
    const data = (node.data ?? {}) as Record<string, string>;
    const provider = data.provider ?? "unknown";
    const label = data.label ?? node.id;

    // --- Vercel ---
    if (provider === "vercel" && data.vercelProjectId) {
      try {
        const token = await getToken("vercel");
        const res = await fetch(
          `https://api.vercel.com/v9/projects/${encodeURIComponent(data.vercelProjectId)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (res.status === 200)
          return {
            node_id: node.id,
            label,
            provider,
            resource_id: data.vercelProjectId,
            exists: true,
            error: null,
          };
        if (res.status === 404)
          return {
            node_id: node.id,
            label,
            provider,
            resource_id: data.vercelProjectId,
            exists: false,
            error: null,
          };
        return {
          node_id: node.id,
          label,
          provider,
          resource_id: data.vercelProjectId,
          exists: null,
          error: `Vercel API returned ${res.status}`,
        };
      } catch (e) {
        if ((e as Error).message?.includes("No vercel connection"))
          return {
            node_id: node.id,
            label,
            provider,
            resource_id: data.vercelProjectId,
            exists: null,
            error: "No Vercel connection",
          };
        return {
          node_id: node.id,
          label,
          provider,
          resource_id: data.vercelProjectId,
          exists: null,
          error: (e as Error).message,
        };
      }
    }

    // --- Supabase ---
    if (provider === "supabase" && data.supabaseProjectRef) {
      try {
        const token = await getToken("supabase");
        const res = await fetch(
          `https://api.supabase.com/v1/projects/${encodeURIComponent(data.supabaseProjectRef)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (res.status === 200)
          return {
            node_id: node.id,
            label,
            provider,
            resource_id: data.supabaseProjectRef,
            exists: true,
            error: null,
          };
        if (res.status === 404)
          return {
            node_id: node.id,
            label,
            provider,
            resource_id: data.supabaseProjectRef,
            exists: false,
            error: null,
          };
        return {
          node_id: node.id,
          label,
          provider,
          resource_id: data.supabaseProjectRef,
          exists: null,
          error: `Supabase API returned ${res.status}`,
        };
      } catch (e) {
        if ((e as Error).message?.includes("No supabase connection"))
          return {
            node_id: node.id,
            label,
            provider,
            resource_id: data.supabaseProjectRef,
            exists: null,
            error: "No Supabase connection",
          };
        return {
          node_id: node.id,
          label,
          provider,
          resource_id: data.supabaseProjectRef,
          exists: null,
          error: (e as Error).message,
        };
      }
    }

    // --- Cloudflare Workers ---
    if (
      provider === "cloudflare" &&
      data.cfWorkerNameProvisioned &&
      data.cloudflareAccountId
    ) {
      try {
        const token = await getToken("cloudflare");
        const res = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(data.cloudflareAccountId)}/workers/scripts/${encodeURIComponent(data.cfWorkerNameProvisioned)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (res.status === 200)
          return {
            node_id: node.id,
            label,
            provider: "cloudflare-workers",
            resource_id: data.cfWorkerNameProvisioned,
            exists: true,
            error: null,
          };
        if (res.status === 404)
          return {
            node_id: node.id,
            label,
            provider: "cloudflare-workers",
            resource_id: data.cfWorkerNameProvisioned,
            exists: false,
            error: null,
          };
        return {
          node_id: node.id,
          label,
          provider: "cloudflare-workers",
          resource_id: data.cfWorkerNameProvisioned,
          exists: null,
          error: `Cloudflare API returned ${res.status}`,
        };
      } catch (e) {
        if ((e as Error).message?.includes("No cloudflare connection"))
          return {
            node_id: node.id,
            label,
            provider: "cloudflare-workers",
            resource_id: data.cfWorkerNameProvisioned,
            exists: null,
            error: "No Cloudflare connection",
          };
        return {
          node_id: node.id,
          label,
          provider: "cloudflare-workers",
          resource_id: data.cfWorkerNameProvisioned,
          exists: null,
          error: (e as Error).message,
        };
      }
    }

    // --- GitHub ---
    if (provider === "github" && data.githubRepoName) {
      try {
        const token = await getToken("github");
        const res = await fetch(
          `https://api.github.com/repos/${data.githubRepoName}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "User-Agent": "Leenar/1.0",
            },
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (res.status === 200)
          return {
            node_id: node.id,
            label,
            provider,
            resource_id: data.githubRepoName,
            exists: true,
            error: null,
          };
        if (res.status === 404)
          return {
            node_id: node.id,
            label,
            provider,
            resource_id: data.githubRepoName,
            exists: false,
            error: null,
          };
        return {
          node_id: node.id,
          label,
          provider,
          resource_id: data.githubRepoName,
          exists: null,
          error: `GitHub API returned ${res.status}`,
        };
      } catch (e) {
        if ((e as Error).message?.includes("No github connection"))
          return {
            node_id: node.id,
            label,
            provider,
            resource_id: data.githubRepoName,
            exists: null,
            error: "No GitHub connection",
          };
        return {
          node_id: node.id,
          label,
          provider,
          resource_id: data.githubRepoName,
          exists: null,
          error: (e as Error).message,
        };
      }
    }

    // --- Unsupported provider ---
    return {
      node_id: node.id,
      label,
      provider,
      resource_id: null,
      exists: null,
      error: "Health check not supported for this provider",
    };
  });

  const nodes = await Promise.all(checks);

  const healthy = nodes.filter((n) => n.exists === true).length;
  const missing = nodes.filter((n) => n.exists === false).length;
  const unknown = nodes.filter((n) => n.exists === null).length;

  return {
    project_id: projectId,
    checked_at: new Date().toISOString(),
    nodes,
    summary: {
      total: nodes.length,
      healthy,
      missing,
      unknown,
    },
  };
}
