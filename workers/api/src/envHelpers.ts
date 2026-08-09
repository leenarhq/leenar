import { decrypt, encrypt } from "./crypto";
import type { Env } from "./types";
import { systemQuery } from "./tenancy";

// None of the functions below take a userId param. They are called from BOTH
// user routes (routes/environments.ts, routes/workflowProvision.ts — always
// AFTER those routes have already verified ownership via scopedByProject/
// scopedByEnv/scopedQuery) and background/provisioning contexts with no user
// in scope at all (provisioner.do.ts, canvasVersion.ts, rollbackExecution.ts,
// driftCheck.ts). Threading a userId through every call site across both
// worlds is not trivial, so systemQuery is used throughout — it is a
// behavior-preserving pass-through, identical to the previous raw calls.

export interface WorkflowEnvironment {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  is_default: boolean;
  display_order: number;
  created_at: string;
}

export interface EnvNodeState {
  status?: string;
  provisionedAt?: string;
  stackId?: string;
  provisionedUrl?: string;
  vercelProjectId?: string;
  supabaseProjectRef?: string;
  githubRepoName?: string;
  cfWorkerNameProvisioned?: string;
  cfBucketNameProvisioned?: string;
  cloudflareWorkerUrl?: string;
  r2Endpoint?: string;
  cloudflareAccountId?: string;
  errorMsg?: string;
  /** Env var keys that should be present on this node's cloud resource.
   *  Written at provision time; drives env_removed / env_stale drift detection. */
  desiredEnvKeys?: string[];
  // ── Native branching (spec 2026-07-19) ─────────────────────────────────
  /** Resolved at deploy time for a branch env node — how this node was
   *  branched off trunk. Drives the native/isolated badge (UI). */
  branchMode?: "native" | "isolated";
  /** Cross-provider git-ref key for this branch (= environment `branch_key`).
   *  Undefined on the default (trunk) environment. */
  branchKey?: string;
  /** GitHub: the branch name created off the default branch (native). */
  githubBranch?: string;
  /** Vercel: the preview branch alias (native) or the isolated project's
   *  production alias (fallback). Used by teardown/promote — exact ref only. */
  vercelBranchAlias?: string;
  /** Supabase: project ref of the cloned branch project (always isolated).
   *  Teardown targets THIS exact ref, never a name pattern. */
  supabaseCloneRef?: string;
  /** Whether the Supabase clone should copy row data (default false = schema
   *  only). Set per branch at create time. */
  seedData?: boolean;
  [key: string]: unknown;
}

export async function getDefaultEnvironmentId(
  env: Env,
  projectId: string,
): Promise<string> {
  const res = await systemQuery(
    env,
    `project_environments?project_id=eq.${projectId}&is_default=eq.true&select=id&limit=1`,
  );
  if (!res.ok)
    throw new Error(
      `Failed to fetch default environment for project ${projectId}: ${res.status}`,
    );
  const rows = (await res.json()) as Array<{ id: string }>;
  if (!rows.length)
    throw new Error(`No default environment for project ${projectId}`);
  return rows[0].id;
}

export async function getEnvironment(
  env: Env,
  environmentId: string,
): Promise<WorkflowEnvironment> {
  const res = await systemQuery(
    env,
    `project_environments?id=eq.${environmentId}&select=id,project_id,name,slug,is_default,display_order,created_at&limit=1`,
  );
  if (!res.ok)
    throw new Error(
      `Failed to fetch environment ${environmentId}: ${res.status}`,
    );
  const rows = (await res.json()) as WorkflowEnvironment[];
  if (!rows.length) throw new Error(`Environment not found: ${environmentId}`);
  return rows[0];
}

export async function getEnvNodeState(
  env: Env,
  environmentId: string,
  nodeId: string,
): Promise<EnvNodeState> {
  const res = await systemQuery(
    env,
    `project_env_node_state?environment_id=eq.${environmentId}&node_id=eq.${encodeURIComponent(nodeId)}&select=state&limit=1`,
  );
  if (!res.ok)
    throw new Error(`Failed to fetch node state for ${nodeId}: ${res.status}`);
  const rows = (await res.json()) as Array<{ state: EnvNodeState }>;
  return rows[0]?.state ?? {};
}

export async function getAllEnvNodeState(
  env: Env,
  environmentId: string,
): Promise<Record<string, EnvNodeState>> {
  const res = await systemQuery(
    env,
    `project_env_node_state?environment_id=eq.${environmentId}&select=node_id,state`,
  );
  if (!res.ok)
    throw new Error(
      `Failed to fetch all node state for environment ${environmentId}: ${res.status}`,
    );
  const rows = (await res.json()) as Array<{
    node_id: string;
    state: EnvNodeState;
  }>;
  return Object.fromEntries(rows.map((r) => [r.node_id, r.state]));
}

export async function setEnvNodeState(
  env: Env,
  environmentId: string,
  nodeId: string,
  partial: Partial<EnvNodeState>,
): Promise<void> {
  const existing = await getEnvNodeState(env, environmentId, nodeId);
  const merged = { ...existing, ...partial };

  await systemQuery(env, "project_env_node_state", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      environment_id: environmentId,
      node_id: nodeId,
      state: merged,
      updated_at: new Date().toISOString(),
    }),
  });
}

export async function getEnvSecretOverrides(
  env: Env,
  environmentId: string,
  nodeId: string,
): Promise<Record<string, string>> {
  const res = await systemQuery(
    env,
    `project_env_secret_overrides?environment_id=eq.${environmentId}&node_id=eq.${encodeURIComponent(nodeId)}&select=env_var_key,value_encrypted`,
  );
  if (!res.ok) return {};
  const rows = (await res.json()) as Array<{
    env_var_key: string;
    value_encrypted: string;
  }>;
  const result: Record<string, string> = {};
  await Promise.all(
    rows.map(async (r) => {
      result[r.env_var_key] = await decrypt(
        r.value_encrypted,
        env.ENCRYPTION_KEY,
      );
    }),
  );
  return result;
}

export async function collectAllOverridesForEnv(
  env: Env,
  environmentId: string,
): Promise<Record<string, Record<string, string>>> {
  const res = await systemQuery(
    env,
    `project_env_secret_overrides?environment_id=eq.${environmentId}&select=node_id,env_var_key,value_encrypted`,
  );
  if (!res.ok)
    throw new Error(
      `Failed to fetch secret overrides for environment ${environmentId}: ${res.status}`,
    );
  const rows = (await res.json()) as Array<{
    node_id: string;
    env_var_key: string;
    value_encrypted: string;
  }>;

  const result: Record<string, Record<string, string>> = {};
  await Promise.all(
    rows.map(async (r) => {
      const plain = await decrypt(r.value_encrypted, env.ENCRYPTION_KEY);
      if (!result[r.node_id]) result[r.node_id] = {};
      result[r.node_id][r.env_var_key] = plain;
    }),
  );
  return result;
}

export async function upsertEnvSecret(
  env: Env,
  environmentId: string,
  nodeId: string,
  key: string,
  value: string,
): Promise<void> {
  const encrypted = await encrypt(value, env.ENCRYPTION_KEY);
  await systemQuery(env, "project_env_secret_overrides", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      environment_id: environmentId,
      node_id: nodeId,
      env_var_key: key,
      value_encrypted: encrypted,
      updated_at: new Date().toISOString(),
    }),
  });
}

export async function deleteEnvSecret(
  env: Env,
  environmentId: string,
  nodeId: string,
  key: string,
): Promise<void> {
  await systemQuery(
    env,
    `project_env_secret_overrides?environment_id=eq.${environmentId}&node_id=eq.${encodeURIComponent(nodeId)}&env_var_key=eq.${encodeURIComponent(key)}`,
    { method: "DELETE" },
  );
}
