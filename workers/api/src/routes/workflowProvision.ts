import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { deprovisionVercel, deleteVercelEnvVar } from "../connectors/vercel";
import { deprovisionSupabase, configureSupabaseAuth } from "../connectors/supabase";
import { verifyRepo } from "../connectors/github";
import {
  getAccountId,
  deprovisionCloudflareWorker,
  deprovisionR2Bucket,
} from "../connectors/cloudflare";
import { isUUID, getUserToken, makeTokenCache, auditLog } from "../utils";
import {
  scopedQuery,
  scopedByProject,
  scopedByStack,
  systemQuery,
  NotOwnedError,
} from "../tenancy";
import { executeRollback } from "../rollbackExecution";
import {
  claimLock,
  releaseLock,
  forceUnlock,
  patchCanvasWithVersion,
  loadCanvasWithVersion,
  patchEnvCanvasRetry,
  loadEnvCanvasWithVersion,
  markConfigOnlyNodesProvisioned,
} from "../canvasVersion";
import { ENV_FLOW, DEFERRED_INJECTION_TARGETS, resolveEnvKeys } from "../constants/envFlow";
import {
  getDefaultEnvironmentId,
  collectAllOverridesForEnv,
  setEnvNodeState,
  getAllEnvNodeState,
} from "../envHelpers";
import { startProvisioner } from "../provisionerStart";
import { createLogger } from "../logger";
import { projectSession, getProvisionedResources } from "../projectEvents";
import { stripRuntimeFromCanvas } from "../canvasRuntime";
import { provisioningHooks } from "../hooks/provisioningHooks";
import { claimDeploySlot } from "../deploy";

const log = createLogger({ route: "workflowProvision" });

export const CanvasNodeSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[a-zA-Z0-9_-]+$/, "Invalid node id"),
  type: z.string().max(64),
  data: z
    .object({
      label: z.string().max(128).optional(),
      provider: z
        .enum(["github", "vercel", "supabase", "resend", "cloudflare"])
        .optional(),
      cloudflareService: z.enum(["workers", "r2"]).optional(),
      cfWorkerName: z.string().max(63).optional(),
      cfBucketName: z.string().max(63).optional(),
      cfWorkerNameProvisioned: z.string().max(63).optional(),
      cfBucketNameProvisioned: z.string().max(63).optional(),
      cloudflareAccountId: z.string().max(64).optional(),
      compatibilityDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
        .optional(),
      cfLocationHint: z
        .enum(["", "wnam", "enam", "weur", "eeur", "apac"])
        .optional(),
      cfWorkerEnvVars: z
        .array(
          z.object({
            key: z
              .string()
              .max(256)
              .regex(/^[A-Z_][A-Z0-9_]*$/, "Keys must be UPPER_SNAKE_CASE"),
            value: z.string().max(32768),
          }),
        )
        .max(50)
        .optional(),
      iconName: z.string().max(64).optional(),
      status: z.string().max(32).optional(),
      existing_repo: z.preprocess(
        (v) => (v === "" ? undefined : v),
        z.string().url().max(512).optional(),
      ),
      branch: z.preprocess(
        (v) => (v === "" ? undefined : v),
        z.string().max(255).optional(),
      ),
      projectName: z.string().max(100).optional(),
      region: z.string().max(32).optional(),
      fromEmail: z.string().max(128).optional(),
      senderName: z.string().max(64).optional(),
      supabaseProjectRef: z.string().max(64).optional(),
      vercelProjectId: z.string().max(64).optional(),
      tables: z
        .array(
          z.object({
            name: z.string().max(63),
            columns: z
              .array(
                z.object({
                  name: z.string().max(63),
                  type: z.enum([
                    "text",
                    "int",
                    "bigint",
                    "boolean",
                    "uuid",
                    "timestamptz",
                    "jsonb",
                    "numeric",
                  ]),
                  nullable: z.boolean().optional(),
                  unique: z.boolean().optional(),
                  default: z.string().max(256).optional(),
                }),
              )
              .max(50),
          }),
        )
        .max(30)
        .optional(),
      customEnvVars: z
        .array(
          z.object({
            key: z
              .string()
              .max(256)
              .regex(/^[A-Z_][A-Z0-9_]*$/, "Keys must be UPPER_SNAKE_CASE"),
            value: z.string().max(32768),
          }),
        )
        .max(50)
        .optional(),
    })
    .passthrough(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});

export const CanvasEdgeSchema = z
  .object({
    id: z.string().min(1).max(256).optional(),
    source: z.string().min(1).max(256),
    target: z.string().min(1).max(256),
    data: z
      .object({
        envVars: z
          .array(
            z
              .string()
              .max(128)
              .regex(/^[A-Z_][A-Z0-9_]{0,127}$/, "Env var names must be UPPER_SNAKE_CASE"),
          )
          .max(20)
          .optional(),
        synced: z.boolean().optional(),
      })
      .strip()
      .optional(),
  })
  .passthrough(); // preserve type, markerEnd, animated, style set by ReactFlow

export const CanvasSchema = z
  .object({
    nodes: z.array(CanvasNodeSchema).max(50),
    edges: z.array(CanvasEdgeSchema).max(200),
  })
  .passthrough(); // preserve viewport

export const workflowProvision = new Hono<{
  Bindings: Env;
  Variables: { userId: string };
}>();

const LABEL_TO_SERVICE: Record<string, string> = {
  github: "github",
  vercel: "vercel",
  supabase: "supabase",
  resend: "resend",
};

export function inferService(data: Record<string, unknown>): string | null {
  const provider = (data.provider as string | undefined)?.toLowerCase();

  if (provider === "cloudflare") {
    const sub = (data.cloudflareService as string | undefined)?.toLowerCase();
    return sub === "r2" ? "cloudflare-r2" : "cloudflare-workers";
  }

  if (provider && LABEL_TO_SERVICE[provider]) return LABEL_TO_SERVICE[provider];

  // Cloudflare has no LABEL_TO_SERVICE entry (one provider maps to two services),
  // so a node carrying only `cloudflareService` or a Cloudflare-ish label — with
  // no `provider` set — would otherwise fall through to null and be silently
  // dropped from the plan. Mirror the provider === "cloudflare" branch above.
  const cfSub = (data.cloudflareService as string | undefined)?.toLowerCase();
  if (cfSub) return cfSub === "r2" ? "cloudflare-r2" : "cloudflare-workers";

  const label = (data.label as string | undefined)?.toLowerCase() ?? "";
  if (
    label.includes("cloudflare") ||
    label.includes("r2") ||
    label.includes("worker")
  ) {
    return label.includes("r2") ? "cloudflare-r2" : "cloudflare-workers";
  }
  for (const [key, val] of Object.entries(LABEL_TO_SERVICE)) {
    if (label.includes(key)) return val;
  }
  return null;
}

export interface CanvasNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export interface CanvasEdge {
  source: string;
  target: string;
  data?: { envVars?: string[] };
}

interface NodeWithData {
  id: string;
  data: Record<string, unknown>;
}

/** Normalize edge direction and compute env injection map.
 *  Priority: edge.data.envVars (user override) > ENV_FLOW forward lookup > reverse flip.
 *  Edges drawn "backwards" (e.g. vercel→supabase when only supabase→vercel is defined)
 *  are flipped so the correct service receives the env vars.
 *  DEFERRED_INJECTION_TARGETS: Supabase cannot receive injection yet — skipped with warn. */
export function normalizeEnvInjection(
  edges: CanvasEdge[],
  nodes: NodeWithData[],
): { envInjection: Record<string, string[]>; normalizedEdges: CanvasEdge[] } {
  const envInjection: Record<string, string[]> = {};
  const normalizedEdges: CanvasEdge[] = [];

  for (const e of edges) {
    const srcNode = nodes.find((n) => n.id === e.source);
    const tgtNode = nodes.find((n) => n.id === e.target);
    const srcSvc = srcNode ? inferService(srcNode.data) : null;
    const tgtSvc = tgtNode ? inferService(tgtNode.data) : null;

    // User override: edge.data.envVars takes priority over ENV_FLOW, but the
    // edge itself still needs the same forward/reverse direction check ENV_FLOW
    // edges get below — otherwise a manually-drawn "backwards" override edge
    // (e.g. Vercel→Supabase when only Supabase→Vercel is a real dependency)
    // would place the dependent service before its dependency in topoSort.
    const overrideVars = e.data?.envVars;
    if (overrideVars && overrideVars.length > 0) {
      const overrideFwd = srcSvc && tgtSvc ? ENV_FLOW[srcSvc]?.[tgtSvc] : undefined;
      const overrideRev = srcSvc && tgtSvc ? ENV_FLOW[tgtSvc]?.[srcSvc] : undefined;
      const overrideShouldFlip = !overrideFwd?.length && !!overrideRev?.length;
      // Run override vars through resolveEnvKeys too — same framework-aware
      // shotgun the ENV_FLOW branch below uses. Base public names (e.g.
      // SUPABASE_URL) get expanded to their NEXT_PUBLIC_/VITE_/… twins on a
      // client target; already-final or non-public names pass through unchanged.
      // Without this, MCP tools (connect_services/setup_workflow/set_edge_env_vars)
      // that freeze ENV_FLOW base names would bypass prefix resolution, so the
      // client-exposed vars (NEXT_PUBLIC_*) never reach Vercel — unlike an
      // identical canvas-drawn edge, which stores empty envVars and hits the
      // ENV_FLOW branch. See useCanvasEdges.onConnect's `data: {}` comment.
      if (overrideShouldFlip) {
        const resolved = resolveEnvKeys(overrideVars, srcSvc ?? "");
        envInjection[e.source] = [
          ...(envInjection[e.source] ?? []),
          ...resolved,
        ];
        normalizedEdges.push({ ...e, source: e.target, target: e.source });
      } else {
        const resolved = resolveEnvKeys(overrideVars, tgtSvc ?? "");
        envInjection[e.target] = [
          ...(envInjection[e.target] ?? []),
          ...resolved,
        ];
        normalizedEdges.push(e);
      }
      continue;
    }

    if (!srcSvc || !tgtSvc) {
      normalizedEdges.push(e);
      continue;
    }

    const fwdVars = ENV_FLOW[srcSvc]?.[tgtSvc]; // base names
    if (fwdVars?.length) {
      // ALWAYS shotgun (no framework) here: injectEnvVars drives the ctx value
      // lookup, and only the NEXT_PUBLIC_* / base value-source keys are present
      // in ctx. Narrowing to a single prefix here would break the value lookup.
      // The connector re-resolves to the detected framework and the narrowing
      // step deletes the wrong-prefix twins from the project.
      const resolved = resolveEnvKeys(fwdVars, tgtSvc);
      envInjection[e.target] = [...(envInjection[e.target] ?? []), ...resolved];
      normalizedEdges.push(e);
    } else {
      const revVars = ENV_FLOW[tgtSvc]?.[srcSvc]; // base names
      if (revVars?.length) {
        // Flipped: e.source becomes the receiver. Shotgun for the same reason.
        const resolved = resolveEnvKeys(revVars, srcSvc);
        envInjection[e.source] = [
          ...(envInjection[e.source] ?? []),
          ...resolved,
        ];
        normalizedEdges.push({ ...e, source: e.target, target: e.source });
      } else {
        normalizedEdges.push(e);
      }
    }
  }

  // Guard: Supabase cannot receive env injection yet (needs Mgmt API — planned enhancement)
  for (const [nodeId, vars] of Object.entries(envInjection)) {
    const node = nodes.find((n) => n.id === nodeId);
    const svc = node ? inferService(node.data) : null;
    if (svc && DEFERRED_INJECTION_TARGETS.has(svc) && vars.length > 0) {
      console.warn(
        `[normalizeEnvInjection] Skipping injection into deferred target "${svc}" (node ${nodeId}). ` +
          `Vars: ${vars.join(", ")}. Provider Mgmt API not yet implemented.`,
      );
      envInjection[nodeId] = [];
    }
  }

  return { envInjection, normalizedEdges };
}

/** Topological sort of nodeIds based on edges (Kahn's algorithm).
 *  Returns sorted node ids — dependencies first. */
export function topoSort(nodeIds: string[], edges: CanvasEdge[]): string[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  for (const e of edges) {
    if (inDegree.has(e.source) && inDegree.has(e.target)) {
      adj.get(e.source)!.push(e.target);
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    }
  }

  const queue = nodeIds.filter((id) => inDegree.get(id) === 0);
  const result: string[] = [];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    result.push(cur);
    for (const next of adj.get(cur) ?? []) {
      const deg = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }

  // Append any remaining nodes (cycles or disconnected) — Set for O(1) lookup
  const resultSet = new Set(result);
  for (const id of nodeIds) {
    if (!resultSet.has(id)) result.push(id);
  }
  return result;
}

export interface ProvisionStep {
  service: string;
  action: string;
  params: Record<string, unknown>;
  nodeId?: string;
  nodeLabel?: string;
  injectEnvVars?: string[];
}

/** Build the ordered list of provisioning steps from canvas nodes + edges.
 *  Filters out github/resend (not standalone provision targets), handles
 *  already-provisioned nodes (inject-only / redeploy), and validates that
 *  Vercel nodes have a repo URL before creating steps. */
export function buildProvisionPlan(
  serviceNodes: CanvasNode[],
  serviceEdges: CanvasEdge[],
  projectName = "leenar",
): { steps: ProvisionStep[]; normalizedEdges: CanvasEdge[]; error?: string } {
  function isAlreadyProvisioned(node: CanvasNode): boolean {
    if ((node.data.status as string) === "provisioned") return true;
    const svc = inferService(node.data);
    if (svc === "vercel" && node.data.vercelProjectId) return true;
    if (svc === "supabase" && node.data.supabaseProjectRef) return true;
    if (svc === "cloudflare-workers" && node.data.cfWorkerNameProvisioned)
      return true;
    if (svc === "cloudflare-r2" && node.data.cfBucketNameProvisioned)
      return true;
    return false;
  }

  const { envInjection, normalizedEdges } = normalizeEnvInjection(
    serviceEdges,
    serviceNodes,
  );
  const nodeIdSet = new Set(serviceNodes.map((n) => n.id));
  const danglingEdge = serviceEdges.find(
    (e) => !nodeIdSet.has(e.source) || !nodeIdSet.has(e.target),
  );
  if (danglingEdge) {
    const missing = !nodeIdSet.has(danglingEdge.source)
      ? danglingEdge.source
      : danglingEdge.target;
    return {
      steps: [],
      normalizedEdges,
      error:
        `Your canvas has a connection pointing to an unknown node ("${missing}"). ` +
        `Remove the broken connection and deploy again.`,
    };
  }
  const ordered = topoSort(
    serviceNodes.map((n) => n.id),
    normalizedEdges,
  );
  const sortedNodes = ordered
    .map((id) => serviceNodes.find((n) => n.id === id))
    .filter(Boolean) as CanvasNode[];

  // Resolve a GitHub repo for a node from a wired GitHub node (edge-gated, the
  // same way env vars flow across edges). Lets Vercel/Worker nodes inherit the
  // repo from a connected GitHub node without it being copied onto the node —
  // the Worker settings UI has no repo field, so the edge is the only source.
  // Direction-agnostic: GitHub is always the repo source regardless of how the
  // edge was drawn.
  const nodeById = new Map(sortedNodes.map((n) => [n.id, n]));
  const repoFromConnectedGithub = (node: CanvasNode): string | undefined => {
    for (const e of serviceEdges) {
      const otherId =
        e.target === node.id
          ? e.source
          : e.source === node.id
            ? e.target
            : undefined;
      if (!otherId) continue;
      const gh = nodeById.get(otherId);
      if (gh && inferService(gh.data) === "github") {
        // Authoring intent (existing_repo) wins, but fall back to the runtime
        // repo the provisioner wrote (githubRepoName) — an auto-created repo
        // only ever populates the latter, and the Worker/Vercel step still
        // needs it. Mirrors the env-derivation fallback below (line ~865) and
        // driftReconcile.ts.
        const repo =
          (gh.data.existing_repo as string | undefined) ||
          (gh.data.githubRepoName as string | undefined);
        if (repo) return repo;
      }
    }
    return undefined;
  };

  const vercelWithoutRepo = sortedNodes.find(
    (n) =>
      inferService(n.data) === "vercel" &&
      !isAlreadyProvisioned(n) &&
      !n.data.existing_repo &&
      !repoFromConnectedGithub(n),
  );
  if (vercelWithoutRepo) {
    return {
      steps: [],
      normalizedEdges,
      error:
        "Your Vercel node needs a GitHub repo URL. Open the Vercel node settings (click the node) and add your repository URL, then deploy again.",
    };
  }

  const supabaseProvisionNodeIds = new Set(
    sortedNodes
      .filter(
        (n) => inferService(n.data) === "supabase" && !isAlreadyProvisioned(n),
      )
      .map((n) => n.id),
  );
  const multipleSupabase = supabaseProvisionNodeIds.size > 1;

  const provisionSteps: ProvisionStep[] = sortedNodes.flatMap((node) => {
    const service = inferService(node.data);
    if (!service) return [];
    if (isAlreadyProvisioned(node)) return [];
    if (service === "github" || service === "resend") return [];

    const params: Record<string, unknown> = {};
    // Repo resolution for repo-deploying services (Vercel, Cloudflare Workers):
    // a CONNECTED GitHub node wins over the node's own existing_repo. The canvas
    // edge is the user's source of truth — a visible github→vercel edge must
    // deploy that repo, not a stale copy the settings picker or creation-time
    // copy (new.tsx) left on the node. The node's own existing_repo is the
    // fallback only when there's no GitHub edge (standalone Vercel + picker).
    const repoFromEdge =
      service === "vercel" || service === "cloudflare-workers"
        ? repoFromConnectedGithub(node)
        : undefined;
    const resolvedRepo =
      repoFromEdge || (node.data.existing_repo as string | undefined);
    if (resolvedRepo) params.existing_repo = resolvedRepo;
    if (node.data.branch) params.branch = node.data.branch;
    if (node.data.projectName) params.projectName = node.data.projectName;
    if (node.data.region) params.region = node.data.region;
    if (service === "cloudflare-workers" && node.data.cfWorkerName) {
      params.cfWorkerName = node.data.cfWorkerName;
    }
    if (service === "cloudflare-workers" && node.data.compatibilityDate) {
      params.compatibilityDate = node.data.compatibilityDate;
    }
    if (
      service === "cloudflare-workers" &&
      Array.isArray(node.data.cfWorkerEnvVars) &&
      node.data.cfWorkerEnvVars.length > 0
    ) {
      const envObj: Record<string, string> = {};
      for (const { key, value } of node.data.cfWorkerEnvVars as Array<{
        key: string;
        value: string;
      }>) {
        if (key && /^[A-Z_][A-Z0-9_]*$/.test(key)) envObj[key] = value;
      }
      params.cfWorkerEnvVars = envObj;
    }
    if (service === "cloudflare-r2" && node.data.cfBucketName) {
      params.cfBucketName = node.data.cfBucketName;
    }
    if (service === "cloudflare-r2" && node.data.cfLocationHint) {
      params.cfLocationHint = node.data.cfLocationHint;
    }
    if (service === "supabase") {
      if (node.data.fromEmail) params.fromEmail = node.data.fromEmail;
      if (node.data.senderName) params.senderName = node.data.senderName;
      if (Array.isArray(node.data.tables) && node.data.tables.length > 0) {
        params.tables = node.data.tables;
      }
      if (multipleSupabase && !node.data.projectName) {
        params.projectName = `${projectName}-${node.id.slice(-6)}`.slice(0, 30);
      }
    }
    if (
      service === "vercel" &&
      Array.isArray(node.data.customEnvVars) &&
      node.data.customEnvVars.length > 0
    ) {
      params.customEnvVars = node.data.customEnvVars;
    }

    return [
      {
        service,
        action: "provision",
        params,
        nodeId: node.id,
        nodeLabel: (node.data.label as string | undefined) ?? service,
        injectEnvVars: envInjection[node.id] ?? [],
      },
    ];
  });

  const provisionedSupabaseNodes = sortedNodes.filter(
    (n) => inferService(n.data) === "supabase" && isAlreadyProvisioned(n),
  );

  const injectOnlySteps: ProvisionStep[] = sortedNodes
    .filter((node) => {
      if (!isAlreadyProvisioned(node)) return false;
      if (inferService(node.data) === "vercel") return false;
      if (!envInjection[node.id]?.length) return false;
      return true;
    })
    .map((node) => {
      // For multi-Supabase canvases: find which Supabase node is connected to
      // this inject target so the provisioner can route the correct credentials.
      const connectedSbNode = provisionedSupabaseNodes.find((sbNode) =>
        serviceEdges.some(
          (e) =>
            (e.source === sbNode.id && e.target === node.id) ||
            (e.target === sbNode.id && e.source === node.id),
        ),
      );
      return {
        service: inferService(node.data)!,
        action: "inject" as const,
        params: {
          supabaseProjectRef: node.data.supabaseProjectRef as
            | string
            | undefined,
          cfWorkerNameProvisioned: node.data.cfWorkerNameProvisioned as
            | string
            | undefined,
          connectedSupabaseNodeId: connectedSbNode?.id,
        },
        nodeId: node.id,
        nodeLabel:
          (node.data.label as string | undefined) ?? inferService(node.data)!,
        injectEnvVars: envInjection[node.id],
      };
    });

  const redeploySteps: ProvisionStep[] = sortedNodes
    .filter(
      (n) =>
        inferService(n.data) === "vercel" &&
        isAlreadyProvisioned(n) &&
        !!n.data.vercelProjectId &&
        ((envInjection[n.id]?.length ?? 0) > 0 ||
          (Array.isArray(n.data.customEnvVars) &&
            (n.data.customEnvVars as Array<{ key: string; value: string }>)
              .length > 0)),
    )
    .map((node) => ({
      service: "vercel" as const,
      action: "redeploy" as const,
      params: {
        vercelProjectId: node.data.vercelProjectId as string,
        existing_repo:
          (node.data.existing_repo as string | undefined) ?? undefined,
        branch: (node.data.branch as string | undefined) ?? undefined,
        customEnvVars:
          Array.isArray(node.data.customEnvVars) &&
          node.data.customEnvVars.length > 0
            ? (node.data.customEnvVars as Array<{ key: string; value: string }>)
            : undefined,
      },
      nodeId: node.id,
      nodeLabel: (node.data.label as string | undefined) ?? "Vercel",
      injectEnvVars: envInjection[node.id] ?? [],
    }));

  const MAX_TABLES = 20;
  const MAX_CF_ENV_VARS = 50;

  const configureSteps: ProvisionStep[] = sortedNodes.flatMap(
    (node): ProvisionStep[] => {
      const service = inferService(node.data);
      if (!service) return [];
      if (!isAlreadyProvisioned(node)) return [];

      if (
        service === "supabase" &&
        Array.isArray(node.data.tables) &&
        node.data.tables.length > 0
      ) {
        const ref = node.data.supabaseProjectRef as string | undefined;
        if (!ref) return [];
        return [
          {
            service,
            action: "configure",
            params: {
              supabaseProjectRef: ref,
              tables: (node.data.tables as unknown[]).slice(0, MAX_TABLES),
              nodeId: node.id,
            },
            nodeId: node.id,
            nodeLabel: (node.data.label as string | undefined) ?? "Supabase",
          },
        ];
      }

      if (
        service === "cloudflare-workers" &&
        Array.isArray(node.data.cfWorkerEnvVars) &&
        node.data.cfWorkerEnvVars.length > 0
      ) {
        const workerName = node.data.cfWorkerNameProvisioned as
          | string
          | undefined;
        if (!workerName) return [];
        const envObj: Record<string, string> = {};
        let count = 0;
        for (const { key, value } of node.data.cfWorkerEnvVars as Array<{
          key: string;
          value: string;
        }>) {
          if (
            key &&
            /^[A-Z_][A-Z0-9_]*$/.test(key) &&
            count < MAX_CF_ENV_VARS
          ) {
            envObj[key] = value;
            count++;
          }
        }
        if (Object.keys(envObj).length === 0) return [];
        return [
          {
            service,
            action: "configure",
            params: {
              cfWorkerNameProvisioned: workerName,
              cfWorkerEnvVars: envObj,
            },
            nodeId: node.id,
            nodeLabel:
              (node.data.label as string | undefined) ?? "Cloudflare Workers",
          },
        ];
      }

      return [];
    },
  );

  const allSteps = [
    ...provisionSteps,
    ...injectOnlySteps,
    ...redeploySteps,
    ...configureSteps,
  ];
  if (allSteps.length === 0) {
    return {
      steps: [],
      normalizedEdges,
      error:
        "No recognizable providers found. Add a Vercel, Supabase, or Cloudflare node to get started.",
    };
  }

  return { steps: allSteps, normalizedEdges };
}

/**
 * Build preloadedCtx for a deployment: fetches Supabase API keys and Resend
 * token for all already-provisioned nodes that have connected steps needing them.
 * Works for Vercel, CF Workers, and any future service.
 */
export async function buildPreloadedCtx(
  env: Env,
  userId: string,
  serviceNodes: CanvasNode[],
  serviceEdges: CanvasEdge[],
  allSteps: ProvisionStep[],
): Promise<Record<string, string>> {
  const preloadedCtx: Record<string, string> = {};

  // All node IDs that have a pending step (provision, inject, or redeploy)
  const stepNodeIds = new Set(
    allSteps.map((s) => s.nodeId).filter(Boolean) as string[],
  );

  const provisionedSupabaseNodes = serviceNodes.filter(
    (n) =>
      inferService(n.data) === "supabase" &&
      (n.data.status === "provisioned" || !!n.data.supabaseProjectRef) &&
      n.data.supabaseProjectRef,
  );

  // Load Supabase keys for every connected provisioned Supabase node.
  // Multi-Supabase canvases: each node gets node-ID-keyed entries; the first
  // also sets the un-suffixed keys for backwards compatibility with single-node steps.
  const connectedSupabaseNodes = provisionedSupabaseNodes.filter((sbNode) =>
    serviceEdges.some(
      (e) =>
        (e.source === sbNode.id && stepNodeIds.has(e.target)) ||
        (e.target === sbNode.id && stepNodeIds.has(e.source)),
    ),
  );
  if (connectedSupabaseNodes.length > 0) {
    try {
      const sbToken = await getUserToken(env, userId, "supabase");
      for (let idx = 0; idx < connectedSupabaseNodes.length; idx++) {
        const sbNode = connectedSupabaseNodes[idx];
        const ref = sbNode.data.supabaseProjectRef as string;
        const keysRes = await fetch(
          `https://api.supabase.com/v1/projects/${ref}/api-keys`,
          { headers: { Authorization: `Bearer ${sbToken}` } },
        );
        if (!keysRes.ok) continue;
        const keys = (await keysRes.json()) as Array<{
          name: string;
          api_key: string;
        }>;
        const anon = keys.find((k) => k.name === "anon")?.api_key ?? "";
        const svcRole =
          keys.find((k) => k.name === "service_role")?.api_key ?? "";
        const url = `https://${ref}.supabase.co`;
        // Node-specific keys used by steps that reference this node by ID
        Object.assign(preloadedCtx, {
          [`supabase_project_ref_${sbNode.id}`]: ref,
          [`supabase_url_${sbNode.id}`]: url,
          [`supabase_anon_key_${sbNode.id}`]: anon,
          [`supabase_service_role_${sbNode.id}`]: svcRole,
        });
        // Un-suffixed keys for the first node (backwards compat with single-Supabase steps)
        if (idx === 0) {
          Object.assign(preloadedCtx, {
            supabase_project_ref: ref,
            supabase_url: url,
            supabase_anon_key: anon,
            supabase_service_role: svcRole,
            NEXT_PUBLIC_SUPABASE_URL: url,
            NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
            SUPABASE_SERVICE_ROLE_KEY: svcRole,
            SUPABASE_URL: url,
            SUPABASE_ANON_KEY: anon,
          });
        }
      }
    } catch {
      // non-fatal — step will run without Supabase ctx
    }
  }

  // Load Resend API key if any step needs it
  const needsResendKey = allSteps.some((s) =>
    s.injectEnvVars?.includes("RESEND_API_KEY"),
  );
  if (needsResendKey) {
    try {
      const resendToken = await getUserToken(env, userId, "resend");
      preloadedCtx["RESEND_API_KEY"] = resendToken;
    } catch {
      // non-fatal — Resend injection skipped
    }
  }

  // Resend SMTP config for already-provisioned Supabase nodes with a Resend edge
  const resendNode = serviceNodes.find(
    (n) => inferService(n.data) === "resend",
  );
  if (resendNode) {
    const supabaseWithResend = provisionedSupabaseNodes.find((sbNode) =>
      serviceEdges.some(
        (e) =>
          (e.source === resendNode.id && e.target === sbNode.id) ||
          (e.source === sbNode.id && e.target === resendNode.id),
      ),
    );
    if (supabaseWithResend) {
      preloadedCtx["resend_smtp_enabled"] = "true";
      if (supabaseWithResend.data.fromEmail)
        preloadedCtx["resend_from_email"] = supabaseWithResend.data
          .fromEmail as string;
      if (supabaseWithResend.data.senderName)
        preloadedCtx["resend_sender_name"] = supabaseWithResend.data
          .senderName as string;
      if (
        !preloadedCtx["supabase_project_ref"] &&
        supabaseWithResend.data.supabaseProjectRef
      )
        preloadedCtx["supabase_project_ref"] = supabaseWithResend.data
          .supabaseProjectRef as string;
    }
  }

  // Helper: is this node wired (either direction) to a node that has a step?
  const connectedToStep = (nodeId: string): boolean =>
    serviceEdges.some(
      (e) =>
        (e.source === nodeId && stepNodeIds.has(e.target)) ||
        (e.target === nodeId && stepNodeIds.has(e.source)),
    );

  // ── GitHub owner/repo (github → vercel/worker) ─────────────────────────────
  // GitHub nodes are config-only — Leenar never provisions them, so no step
  // output ever writes GITHUB_OWNER/GITHUB_REPO, yet ENV_FLOW promises them to a
  // connected Vercel/Worker. Derive from the node's repo, mirroring driftReconcile.
  for (const gh of serviceNodes) {
    if (inferService(gh.data) !== "github") continue;
    if (!connectedToStep(gh.id)) continue;
    const repo =
      (gh.data.existing_repo as string | undefined) ||
      (gh.data.githubRepoName as string | undefined);
    if (!repo) continue;
    const slug = repo
      .replace(/^https?:\/\/github\.com\//, "")
      .replace(/\.git$/, "");
    const [owner, name] = slug.split("/");
    // Node-scoped twins (mirrors Supabase supabase_url_${id}) so a multi-node
    // canvas with >1 github repo doesn't cross-wire — executeStep prefers the
    // twin from the repo actually wired to the step. Global keys kept for
    // single-node backward-compat.
    if (owner) {
      preloadedCtx["GITHUB_OWNER"] = owner;
      preloadedCtx[`GITHUB_OWNER_${gh.id}`] = owner;
    }
    if (name) {
      preloadedCtx["GITHUB_REPO"] = name;
      preloadedCtx[`GITHUB_REPO_${gh.id}`] = name;
    }
    preloadedCtx["GITHUB_REPO_URL"] = `https://github.com/${slug}`;
    preloadedCtx[`GITHUB_REPO_URL_${gh.id}`] = `https://github.com/${slug}`;
  }

  // ── Already-provisioned Cloudflare Worker URL (cloudflare-workers → vercel) ─
  // Fresh deploys get API_URL/WORKER_URL from the worker step output; an
  // incremental deploy where the worker already exists has no such step, so
  // preload from node data. API_URL/WORKER_URL are PUBLIC_ENV_BASES — also write
  // the NEXT_PUBLIC_ twin so the Vercel connector's PUBLIC_VALUE_ALIASES resolves.
  for (const w of serviceNodes) {
    if (inferService(w.data) !== "cloudflare-workers") continue;
    const url =
      (w.data.cloudflareWorkerUrl as string | undefined) ||
      (w.data.provisionedUrl as string | undefined);
    if (!url || !connectedToStep(w.id)) continue;
    Object.assign(preloadedCtx, {
      API_URL: url,
      WORKER_URL: url,
      NEXT_PUBLIC_API_URL: url,
      NEXT_PUBLIC_WORKER_URL: url,
      // Node-scoped twins (see GitHub block) for multi-worker canvases.
      [`API_URL_${w.id}`]: url,
      [`WORKER_URL_${w.id}`]: url,
      [`NEXT_PUBLIC_API_URL_${w.id}`]: url,
      [`NEXT_PUBLIC_WORKER_URL_${w.id}`]: url,
    });
  }

  // ── Already-provisioned Vercel URL (vercel → cloudflare-workers) ───────────
  // ALLOWED_ORIGIN/FRONTEND_URL are not public bases — injected verbatim into
  // the Worker. Fresh deploys get these from the Vercel step output.
  //
  // vercel_project_url is also plumbed here: postConfigureAuth reads it to set
  // the Supabase Auth site_url / redirect allow-list. On an incremental deploy
  // where Vercel is already up (no Vercel step runs) but Supabase is
  // (re)provisioning, the step output can't supply it — without this preload the
  // Supabase project keeps its default http://localhost:3000 site URL and email
  // confirmation links point at localhost.
  for (const v of serviceNodes) {
    if (inferService(v.data) !== "vercel") continue;
    const url = v.data.provisionedUrl as string | undefined;
    if (!url || !connectedToStep(v.id)) continue;
    Object.assign(preloadedCtx, {
      ALLOWED_ORIGIN: url,
      FRONTEND_URL: url,
      vercel_project_url: url,
      // Node-scoped twins (see GitHub block) for multi-vercel canvases.
      [`ALLOWED_ORIGIN_${v.id}`]: url,
      [`FRONTEND_URL_${v.id}`]: url,
      [`vercel_project_url_${v.id}`]: url,
    });
  }

  return preloadedCtx;
}

workflowProvision.post("/:projectId/provision", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  if (!isUUID(projectId)) return c.json({ error: "Invalid id" }, 400);

  if (!(await provisioningHooks.rateLimit.check(c.env, userId, "deploy", 10, 10 * 60_000))) {
    return c.json(
      {
        error:
          "Too many deploys. Please wait a few minutes before trying again.",
      },
      429,
    );
  }

  // Block concurrent deployments — auto-heals stacks whose session finished or timed out.
  // Claiming the provision lock happens further below, AFTER canvas validation
  // (so invalid-input 400s never acquire a lock) — see claimDeploySlot in ../deploy
  // for the shared active-check/heal logic used by all deployWorkflow callers.
  const activeCheck = await claimDeploySlot(c.env, projectId, userId, {
    skipLockClaim: true,
  });
  if (!activeCheck.ok) {
    return c.json(
      {
        error: activeCheck.error,
        ...(activeCheck.lockedAt ? { lockedAt: activeCheck.lockedAt } : {}),
        ...(activeCheck.lockedBy ? { lockedBy: activeCheck.lockedBy } : {}),
      },
      activeCheck.status,
    );
  }

  // Validate canvas BEFORE claiming the lock so invalid-input 400s never acquire a lock
  const raw = await c.req.json();
  const parsed = CanvasSchema.safeParse((raw as any)?.canvas);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid canvas: " + parsed.error.issues[0]?.message },
      400,
    );
  }

  // Claim the provision lock — prevents concurrent deploys and canvas writes during provisioning
  const lockResult = await claimLock(c.env, projectId, userId, "provisioning");
  if (!lockResult.ok) {
    return c.json(
      {
        error: "Workflow is currently being provisioned by another session.",
        lockedAt: lockResult.lockedAt,
        lockedBy: lockResult.lockedBy,
      },
      423,
    );
  }
  const canvas = parsed.data as { nodes: CanvasNode[]; edges: CanvasEdge[] };
  const projectNameOverride = (raw as any)?.projectName as string | undefined;
  const rawEnvId = (raw as any)?.environmentId as string | undefined;
  const nodeIds = Array.isArray((raw as any)?.nodeIds)
    ? ((raw as any).nodeIds as string[])
    : undefined;

  // Track whether the DO took ownership of the lock. If it didn't (any error
  // path below), the finally block releases it so the canvas isn't stuck.
  let doStarted = false;
  try {
    // Resolve environment — use provided env or fall back to default
    let environmentId: string;
    try {
      environmentId =
        rawEnvId && isUUID(rawEnvId)
          ? rawEnvId
          : await getDefaultEnvironmentId(c.env, projectId);
    } catch {
      return c.json({ error: "Workflow environment not found" }, 404);
    }

    const serviceNodes = canvas.nodes.filter((n) => n.type === "service");
    if (serviceNodes.length === 0) {
      return c.json(
        {
          error:
            "No provider nodes found. Add at least one provider to the canvas.",
        },
        400,
      );
    }

    // Only keep service→service edges for ordering
    const serviceIds = new Set(serviceNodes.map((n) => n.id));
    const serviceEdges = (canvas.edges ?? []).filter(
      (e) => serviceIds.has(e.source) && serviceIds.has(e.target),
    );

    log.info("provision.edges", {
      edges: serviceEdges.map((e) => ({
        src: e.source,
        tgt: e.target,
        envVars: e.data?.envVars ?? [],
      })),
    });

    // Resolve project name first so buildProvisionPlan can use it for multi-Supabase naming
    const wfNameRes = await scopedQuery(c.env, userId, "projects", {
      query: `id=eq.${projectId}&select=name&limit=1`,
    });
    if (!wfNameRes.ok)
      return c.json(
        { error: "Service temporarily unavailable. Please try again." },
        503,
      );
    const wfNameRows = (await wfNameRes.json()) as Array<{ name: string }>;
    if (!wfNameRows[0]) return c.json({ error: "Workflow not found" }, 404);
    const rawName = wfNameRows[0].name ?? "Leenar Project";
    // Append first 6 chars of workflow ID to guarantee uniqueness across users.
    // Sanitize projectNameOverride (explicit user input) before using it.
    const projectName =
      sanitizeProjectName(
        projectNameOverride,
        `${rawName}-${projectId.slice(0, 6)}`,
      ) || `${rawName}-${projectId.slice(0, 6)}`;

    // Load per-env secret overrides and apply them to canvas node customEnvVars
    let secretOverrides: Record<string, Record<string, string>> = {};
    try {
      secretOverrides = await collectAllOverridesForEnv(c.env, environmentId);
    } catch {
      // Non-fatal — proceed without overrides
    }

    if (Object.keys(secretOverrides).length > 0) {
      for (const node of canvas.nodes) {
        const nodeOverrides = secretOverrides[node.id];
        if (!nodeOverrides) continue;
        const existing =
          (node.data.customEnvVars as
            | Array<{ key: string; value: string }>
            | undefined) ?? [];
        const merged = [...existing];
        for (const [key, value] of Object.entries(nodeOverrides)) {
          const idx = merged.findIndex((e) => e.key === key);
          if (idx >= 0) merged[idx] = { key, value };
          else merged.push({ key, value });
        }
        node.data = { ...node.data, customEnvVars: merged };
      }
    }

    const { steps: allSteps, error: planError } = buildProvisionPlan(
      serviceNodes,
      serviceEdges,
      projectName,
    );
    if (planError) return c.json({ error: planError }, 400);

    const filteredSteps = nodeIds?.length
      ? allSteps.filter(
          (s) => s.nodeId !== undefined && nodeIds.includes(s.nodeId),
        )
      : allSteps;

    if (nodeIds?.length && filteredSteps.length === 0) {
      return c.json(
        {
          error:
            "No matching steps for provided nodeIds. The canvas may have changed.",
        },
        400,
      );
    }

    // Validate that user has connections for all required services
    const requiredServices = [...new Set(filteredSteps.map((s) => s.service))];
    const connRes = await scopedQuery(c.env, userId, "user_connections", {
      query: `select=service`,
    });
    if (!connRes.ok)
      return c.json(
        { error: "Service temporarily unavailable. Please try again." },
        503,
      );
    const connRows = (await connRes.json()) as Array<{ service: string }>;
    const connected = new Set(connRows.map((r) => r.service));
    // cloudflare-workers and cloudflare-r2 both use the single 'cloudflare' token
    const normalizedRequired = requiredServices.map((s) =>
      s.startsWith("cloudflare-") ? "cloudflare" : s,
    );
    const missing = [...new Set(normalizedRequired)].filter(
      (s) => !connected.has(s),
    );
    if (missing.length > 0) {
      return c.json(
        {
          error: `Missing connections: ${missing.join(", ")}. Connect these in Settings → Connections first.`,
          missingServices: missing,
        },
        400,
      );
    }

    const preloadedCtx = await buildPreloadedCtx(
      c.env,
      userId,
      serviceNodes,
      serviceEdges,
      allSteps,
    );

    // Create stack record
    const stackRes = await scopedQuery(c.env, userId, "stacks", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        project_id: projectId,
        environment_id: environmentId,
        name: projectName,
        status: "draft",
        requirements: {
          services: allSteps
            .filter((s) => s.action === "provision")
            .map((s) => ({
              service_type: s.service,
              display_name: s.nodeLabel,
            })),
        },
      },
    });
    const stackRows = (await stackRes.json()) as Array<{ id: string }>;
    const stackId = stackRows[0]?.id;
    if (!stackId)
      return c.json({ error: "Failed to create stack record" }, 500);

    // Trigger ProvisionerDO — it creates the session and returns sessionId
    let sessionId: string;
    try {
      const started = await startProvisioner(c.env, stackId, userId, {
        projectName,
        steps: filteredSteps,
        preloadedCtx,
      });
      sessionId = started.sessionId;
      doStarted = true;
    } catch (err) {
      // DO start failed — clean up orphaned stack record so next deploy isn't blocked
      await scopedQuery(c.env, userId, "stacks", {
        query: `id=eq.${stackId}`,
        method: "DELETE",
      }).catch(() => {});
      log.error("provision.do_start_failed", {
        err: err instanceof Error ? err.message : String(err),
      });
      return c.json(
        { error: "Failed to start deployment. Please try again." },
        500,
      );
    }

    return c.json({ ok: true, stackId, sessionId });
  } finally {
    // DO takes ownership of the lock on success and releases it when done.
    // On any error path that never reached the DO, release it here.
    if (!doStarted) {
      await releaseLock(c.env, projectId).catch(() => {});
    }
  }
});

// POST /api/workflows/import — create a new workflow from a JSON canvas export.
// Canvas is validated with CanvasSchema (Zod) before writing to DB.
workflowProvision.post("/import", async (c) => {
  const userId = c.get("userId");
  const raw = await c.req.json().catch(() => null);
  if (!raw) return c.json({ error: "Invalid JSON" }, 400);

  const name =
    typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim().slice(0, 128)
      : "Imported Workflow";

  const parsed = CanvasSchema.safeParse(raw.canvas ?? raw);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid canvas: " + parsed.error.issues[0]?.message },
      400,
    );
  }

  const res = await scopedQuery(c.env, userId, "projects", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: {
      name,
      canvas: parsed.data,
      status: "draft",
      canvas_version: 1,
    },
  });
  if (!res.ok) return c.json({ error: "Failed to create workflow" }, 500);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  const wf = rows[0];
  if (!wf) return c.json({ error: "Failed to create workflow" }, 500);
  return c.json(wf, 201);
});

// POST /api/projects/from-scan — create a new workflow from scanned account resources.
// All nodes are marked imported: true so deprovision never touches pre-existing cloud resources.
workflowProvision.post("/from-scan", async (c) => {
  const userId = c.get("userId");
  const raw = await c.req.json().catch(() => null);
  if (!raw) return c.json({ error: "Invalid JSON" }, 400);

  if (!(await provisioningHooks.rateLimit.check(c.env, userId, "from_scan", 10, 60_000))) {
    return c.json({ error: "Too many requests. Please wait a moment." }, 429);
  }

  const name =
    typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim().slice(0, 128)
      : "Imported Stack";

  const vercelProjects: Array<{
    id: string;
    name: string;
    link?: { org?: string; repo?: string };
  }> = Array.isArray(raw.vercelProjects) ? raw.vercelProjects : [];

  const supabaseProjects: Array<{
    ref: string;
    name: string;
    region?: string;
  }> = Array.isArray(raw.supabaseProjects) ? raw.supabaseProjects : [];

  const githubRepos: Array<{
    full_name: string;
  }> = Array.isArray(raw.githubRepos) ? raw.githubRepos : [];

  const connections: Array<{
    fromService: string;
    fromRef: string;
    toService: string;
    toRef: string;
  }> = Array.isArray(raw.connections) ? raw.connections : [];

  const total = vercelProjects.length + supabaseProjects.length + githubRepos.length;
  if (total === 0) return c.json({ error: "No projects selected" }, 400);
  if (total > 20) return c.json({ error: "Too many projects selected (max 20)" }, 400);

  const idPrefix = Date.now();
  const vercelIdMap = new Map<string, string>(); // vercelProjectId → nodeId
  const supabaseRefMap = new Map<string, string>(); // supabaseRef → nodeId
  const githubRepoMap = new Map<string, string>(); // full_name → nodeId

  const nodes: Array<Record<string, unknown>> = [];

  vercelProjects.forEach((p, i) => {
    if (!p.id || typeof p.id !== "string") return;
    const nodeId = `service-${idPrefix}-v${i}`;
    vercelIdMap.set(p.id, nodeId);
    const repoFull =
      p.link?.org && p.link?.repo
        ? `${p.link.org}/${p.link.repo}`
        : undefined;
    nodes.push({
      id: nodeId,
      type: "service",
      position: { x: 160 + i * 320, y: 200 },
      data: {
        label: "Vercel",
        iconName: "Triangle",
        provider: "vercel",
        status: "provisioned",
        imported: true,
        vercelProjectId: p.id,
        provisionedUrl: `https://${p.name}.vercel.app`,
        incidents: [],
        incidentCount: 0,
        ...(repoFull ? { existing_repo: `https://github.com/${repoFull}` } : {}),
      },
    });
  });

  supabaseProjects.forEach((p, i) => {
    if (!p.ref || typeof p.ref !== "string") return;
    const nodeId = `service-${idPrefix}-s${i}`;
    supabaseRefMap.set(p.ref, nodeId);
    nodes.push({
      id: nodeId,
      type: "service",
      position: { x: 160 + i * 320, y: 500 },
      data: {
        label: "Supabase",
        iconName: "Database",
        provider: "supabase",
        status: "provisioned",
        imported: true,
        supabaseProjectRef: p.ref,
        provisionedUrl: `https://supabase.com/dashboard/project/${p.ref}`,
        incidents: [],
        incidentCount: 0,
        ...(p.region ? { region: p.region } : {}),
      },
    });
  });

  githubRepos.forEach((r, i) => {
    if (!r.full_name || typeof r.full_name !== "string") return;
    const nodeId = `service-${idPrefix}-g${i}`;
    githubRepoMap.set(r.full_name, nodeId);
    nodes.push({
      id: nodeId,
      type: "service",
      position: { x: 160 + i * 320, y: -100 },
      data: {
        label: "GitHub",
        iconName: "Github",
        provider: "github",
        status: "provisioned",
        imported: true,
        githubRepoName: r.full_name,
        existing_repo: `https://github.com/${r.full_name}`,
        provisionedUrl: `https://github.com/${r.full_name}`,
        incidents: [],
        incidentCount: 0,
      },
    });
  });

  const edges: Array<Record<string, unknown>> = connections
    .map((conn, i) => {
      const srcNodeId =
        conn.fromService === "vercel"
          ? vercelIdMap.get(conn.fromRef)
          : conn.fromService === "supabase"
            ? supabaseRefMap.get(conn.fromRef)
            : githubRepoMap.get(conn.fromRef);
      const tgtNodeId =
        conn.toService === "vercel"
          ? vercelIdMap.get(conn.toRef)
          : conn.toService === "supabase"
            ? supabaseRefMap.get(conn.toRef)
            : githubRepoMap.get(conn.toRef);
      if (!srcNodeId || !tgtNodeId) return null;
      // Base names only used to decide the "wired" marker color. envVars is left
      // unfrozen so the backend resolves ENV_FLOW + framework at provision time.
      const wired = (ENV_FLOW[conn.fromService]?.[conn.toService]?.length ?? 0) > 0;
      return {
        id: `scan-edge-${idPrefix}-${i}`,
        source: srcNodeId,
        target: tgtNodeId,
        type: "blueprint",
        animated: false,
        markerEnd: {
          type: "arrowclosed",
          color: wired ? "#34d399" : "#3b82f6",
        },
      };
    })
    .filter(Boolean) as Array<Record<string, unknown>>;

  const parsed = CanvasSchema.safeParse({ nodes, edges });
  if (!parsed.success) {
    return c.json(
      { error: "Canvas build error: " + parsed.error.issues[0]?.message },
      500,
    );
  }

  const canvas = { ...parsed.data, viewport: { x: 0, y: 0, zoom: 1 } };

  const res = await scopedQuery(c.env, userId, "projects", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: { name, canvas, status: "active" },
  });
  if (!res.ok) return c.json({ error: "Failed to create workflow" }, 500);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  const wf = rows[0];
  if (!wf) return c.json({ error: "Failed to create workflow" }, 500);

  auditLog(c.env, userId, "workflow_imported_from_scan", {
    projectId: wf.id,
    vercelCount: vercelProjects.length,
    supabaseCount: supabaseProjects.length,
    githubCount: githubRepos.length,
  });

  // Imported resources never pass through the provisioner DO (which is where
  // deploy-provisioned resources get their monitor), so start log-based
  // incident monitoring here. Only Vercel is log-pollable among importables.
  for (const p of vercelProjects) {
    if (p.id && typeof p.id === "string") {
      provisioningHooks.monitor
        .start(c.env, wf.id as string, userId, "vercel", p.id)
        .catch(() => {});
    }
  }

  return c.json(wf, 201);
});

workflowProvision.post("/:projectId/import-node", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  if (!isUUID(projectId)) return c.json({ error: "Invalid id" }, 400);

  const wfRes = await scopedQuery(c.env, userId, "projects", {
    query: `id=eq.${projectId}&select=id&limit=1`,
  });
  const wfRows = (await wfRes.json()) as unknown[];
  if (!wfRows[0]) return c.json({ error: "Not found" }, 404);

  if (!(await provisioningHooks.rateLimit.check(c.env, userId, "import", 20, 60_000))) {
    return c.json(
      { error: "Too many import requests. Please wait a moment." },
      429,
    );
  }

  const { service, identifier, envId } = await c.req.json<{
    service: string;
    identifier: string;
    envId?: string;
  }>();
  if (!identifier?.trim()) return c.json({ error: "identifier required" }, 400);
  const reqEnvId = typeof envId === "string" && envId.trim() ? envId.trim() : undefined;

  if (service === "vercel") {
    let slug = identifier.trim();
    // https://vercel.com/team/project-name  →  project-name
    const vUrlMatch = slug.match(/vercel\.com\/[^/]+\/([^/?#]+)/);
    if (vUrlMatch) slug = vUrlMatch[1];
    // https://project-name.vercel.app  →  project-name
    const appMatch = slug.match(/^https?:\/\/([^.]+)\.vercel\.app/);
    if (appMatch) slug = appMatch[1];
    // strip any remaining protocol/path
    slug = slug
      .replace(/^https?:\/\//, "")
      .split("/")[0]
      .split("?")[0];

    let token: string;
    try {
      token = await getUserToken(c.env, userId, "vercel");
    } catch {
      return c.json(
        {
          error:
            "No Vercel connection found. Connect your account in Integrations first.",
        },
        400,
      );
    }

    const res = await fetch(
      `https://api.vercel.com/v9/projects/${encodeURIComponent(slug)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (res.status === 404)
      return c.json(
        {
          error: `Vercel project "${slug}" not found. Check the project name.`,
        },
        404,
      );
    if (!res.ok) return c.json({ error: "Failed to reach Vercel API" }, 502);

    const project = await res.json<{
      id: string;
      name: string;
      link?: { org?: string; repo?: string };
    }>();
    const repoFull =
      project.link?.org && project.link?.repo
        ? `${project.link.org}/${project.link.repo}`
        : undefined;
    const nodeData: Record<string, unknown> = {
      label: "Vercel",
      iconName: "Triangle",
      provider: "vercel",
      status: "provisioned",
      imported: true,
      vercelProjectId: project.id,
      provisionedUrl: `https://${project.name}.vercel.app`,
      ...(repoFull
        ? { existing_repo: `https://github.com/${repoFull}` }
        : {}),
    };
    return finalizeImport(c, projectId, userId, "vercel", nodeData, reqEnvId);
  }

  if (service === "supabase") {
    let ref = identifier.trim();
    // https://abc123.supabase.co  →  abc123
    const supaMatch = ref.match(/([a-z0-9]+)\.supabase\.co/);
    if (supaMatch) ref = supaMatch[1];
    ref = ref
      .replace(/^https?:\/\//, "")
      .split(".")[0]
      .split("/")[0];

    let token: string;
    try {
      token = await getUserToken(c.env, userId, "supabase");
    } catch {
      return c.json(
        {
          error:
            "No Supabase connection found. Connect your account in Integrations first.",
        },
        400,
      );
    }

    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404)
      return c.json(
        {
          error: `Supabase project "${ref}" not found. Check the project ref.`,
        },
        404,
      );
    if (!res.ok) return c.json({ error: "Failed to reach Supabase API" }, 502);

    const project = await res.json<{
      id: string;
      name: string;
      region: string;
    }>();
    const nodeData: Record<string, unknown> = {
      label: "Supabase",
      iconName: "Database",
      provider: "supabase",
      status: "provisioned",
      imported: true,
      supabaseProjectRef: ref,
      supabaseDbHost: `db.${ref}.supabase.co`,
      provisionedUrl: `https://supabase.com/dashboard/project/${ref}`,
      region: project.region,
    };
    return finalizeImport(c, projectId, userId, "supabase", nodeData, reqEnvId);
  }

  if (service === "github") {
    let fullName = identifier.trim();
    fullName = fullName
      .replace(/^https?:\/\/github\.com\//, "")
      .replace(/\.git$/, "")
      .replace(/#.*$/, "")
      .trim();
    if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(fullName)) {
      return c.json(
        { error: "Invalid repository format. Use owner/repo." },
        400,
      );
    }

    let token: string;
    try {
      token = await getUserToken(c.env, userId, "github");
    } catch {
      return c.json(
        { error: "No GitHub connection found for this user." },
        400,
      );
    }

    let repo: { full_name: string; html_url: string; default_branch: string };
    try {
      repo = await verifyRepo(token, fullName);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("not found")) {
        return c.json({ error: "GitHub repo not found." }, 400);
      }
      return c.json({ error: "Failed to reach GitHub API" }, 502);
    }

    const nodeData: Record<string, unknown> = {
      label: "GitHub",
      iconName: "Github",
      provider: "github",
      status: "provisioned",
      imported: true,
      githubRepoName: repo.full_name,
      githubRepoUrl: repo.html_url,
      provisionedUrl: repo.html_url,
    };
    return finalizeImport(c, projectId, userId, "github", nodeData, reqEnvId);
  }

  return c.json(
    { error: 'Unsupported service. Use "github", "vercel" or "supabase".' },
    400,
  );
});

// Fields that belong on the canvas node's `data` (authoring state, part of the
// canvas JSON persisted on projects/project_environments).
const IMPORT_AUTHORING_KEYS = [
  "label",
  "iconName",
  "provider",
  "imported",
  "existing_repo",
  "region",
] as const;

// Fields that belong in project_env_node_state (runtime status, resolved at
// load time and merged onto the node for rendering — not part of canvas JSON).
const IMPORT_RUNTIME_KEYS = [
  "status",
  "provisionedAt",
  "provisionedUrl",
  "vercelProjectId",
  "supabaseProjectRef",
  "githubRepoName",
  "githubRepoUrl",
] as const;

function normalizeRepoRef(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .toLowerCase();
}

type ImportEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
  animated: boolean;
  selected: boolean;
  markerEnd: { type: string; color: string };
  data: { synced: boolean; envVars: string[] };
};

/**
 * After importing a node, look for existing canvas nodes it's already
 * provably connected to in the real world — a Vercel project linked to a
 * GitHub repo, or a Vercel project whose env vars reference a Supabase
 * project — and auto-create the corresponding edge so imported services
 * don't land on the canvas disconnected. Only creates an edge when the
 * relationship is confirmed by cloud metadata; never guesses.
 */
async function detectImportEdges(
  c: Context<{ Bindings: Env; Variables: { userId: string } }>,
  userId: string,
  projectId: string,
  environmentId: string,
  service: "github" | "vercel" | "supabase",
  nodeData: Record<string, unknown>,
  newNodeId: string,
  existingNodes: Array<{ id: string; data?: Record<string, unknown> }>,
): Promise<ImportEdge[]> {
  if (existingNodes.length === 0) return [];
  const nodeStates = await getAllEnvNodeState(c.env, environmentId).catch(
    () => ({}) as Record<string, Record<string, unknown>>,
  );
  const merged = existingNodes.map((n) => ({
    id: n.id,
    data: { ...(n.data ?? {}), ...(nodeStates[n.id] ?? {}) } as Record<
      string,
      unknown
    >,
  }));

  // Imported nodes represent resources that are already live in the real
  // infra, so a detected connection between two of them is real too — UNLESS
  // this project has never had a successful deploy through Leenar. In that
  // case there's no established "already provisioned via Leenar" state to
  // trust yet, so the edge should wait for a real Deploy run like any other
  // edge instead of claiming "Injected on provision" (see BlueprintEdge.tsx).
  const readyStackRes = await scopedQuery(c.env, userId, "stacks", {
    query: `project_id=eq.${projectId}&status=eq.ready&select=id&limit=1`,
  }).catch(() => null);
  const readyStackRows = readyStackRes?.ok
    ? ((await readyStackRes.json().catch(() => [])) as Array<{ id: string }>)
    : [];
  const hasDeployedBefore = readyStackRows.length > 0;

  const makeEdge = (
    source: string,
    target: string,
    srcKey: string,
    tgtKey: string,
  ): ImportEdge => {
    // Import edges reflect already-live infra. Resolve base names to the
    // receiver's client prefixes (shotgun — framework unknown at import) so the
    // frozen names match what provisioning would inject.
    const fwd = ENV_FLOW[srcKey]?.[tgtKey];
    const base = fwd ?? ENV_FLOW[tgtKey]?.[srcKey] ?? [];
    const receiver = fwd ? tgtKey : srcKey;
    return {
      id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source,
      target,
      type: "blueprint",
      animated: false,
      selected: false,
      markerEnd: { type: "arrowclosed", color: "#34d399" },
      data: {
        // Import edges represent connections that already exist in the real
        // infra (the two resources are already live and wired up) — unlike
        // edges drawn during interactive provisioning, there's nothing left
        // to deploy, so mark synced immediately instead of waiting for a
        // Deploy run to flip this (see useDeployFlow.ts on the frontend).
        // Exception: a project that's never had a successful deploy through
        // Leenar has no "provisioned via Leenar" baseline yet, so don't claim one.
        synced: hasDeployedBefore,
        envVars: resolveEnvKeys(base, receiver),
      },
    };
  };

  const edges: ImportEdge[] = [];

  // Vercel's own /env list endpoint never returns a real decrypted value for
  // "encrypted"-type vars to an OAuth-integration token — decrypt=true (and
  // the legacy source=vercel-cli:pull path) both come back with a
  // ciphertext-shaped string instead of plaintext. Verified against
  // production: identical value length with or without the pull param.
  // So we can't read POSTGRES_URL/SUPABASE_URL contents to extract a ref.
  // Instead, match on the *keys* the official Supabase-Vercel integration
  // always injects (these are structural, not secret, so listing keys
  // without decrypt works reliably — same as the existing getExistingEnvs
  // helper in connectors/vercel.ts).
  const SUPABASE_ENV_KEY_RE =
    /^(NEXT_PUBLIC_)?SUPABASE_(URL|ANON_KEY|SERVICE_ROLE_KEY|JWT_SECRET)$|^POSTGRES(_PRISMA|_URL_NON_POOLING)?_URL$/i;

  // Checks whether a Vercel project has any Supabase-integration env keys.
  // Never throws — callers get false (and a log line) on any fetch failure.
  const hasSupabaseEnvKeys = async (
    vercelProjectId: string,
  ): Promise<boolean> => {
    try {
      const token = await getUserToken(c.env, userId, "vercel");
      const res = await fetch(
        `https://api.vercel.com/v10/projects/${vercelProjectId}/env`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!res.ok) {
        log.warn("import.supabase_vercel_match.fetch_failed", {
          vercelProjectId,
          status: res.status,
        });
        return false;
      }
      const envData = await res.json<{ envs?: Array<{ key?: string }> }>();
      const matchedKeys = (envData.envs ?? [])
        .map((e) => e.key ?? "")
        .filter((k) => SUPABASE_ENV_KEY_RE.test(k));
      log.info("import.supabase_vercel_match.debug", {
        vercelProjectId,
        matchedKeys,
      });
      return matchedKeys.length > 0;
    } catch (err) {
      log.warn("import.supabase_vercel_match.error", {
        vercelProjectId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  };

  if (service === "vercel") {
    const vercelRepo = normalizeRepoRef(
      nodeData.existing_repo as string | undefined,
    );
    if (vercelRepo) {
      for (const n of merged) {
        if (n.data.provider !== "github") continue;
        const repo =
          normalizeRepoRef(n.data.githubRepoUrl as string | undefined) ??
          normalizeRepoRef(n.data.githubRepoName as string | undefined);
        if (repo && repo === vercelRepo) {
          edges.push(makeEdge(n.id, newNodeId, "github", "vercel"));
        }
      }
    }

    const supabaseNodes = merged.filter(
      (n) => n.data.provider === "supabase" && n.data.supabaseProjectRef,
    );
    const vercelProjectId = nodeData.vercelProjectId as string | undefined;
    // Key-based matching can't disambiguate which Supabase project a Vercel
    // project references when more than one is on the canvas — only connect
    // when there's exactly one candidate to avoid a wrong guess.
    if (supabaseNodes.length === 1 && vercelProjectId) {
      const matched = await hasSupabaseEnvKeys(vercelProjectId);
      if (matched) {
        edges.push(makeEdge(supabaseNodes[0].id, newNodeId, "supabase", "vercel"));
      }
    } else {
      log.info("import.supabase_vercel_match.skipped", {
        reason:
          supabaseNodes.length === 0
            ? "no_supabase_nodes_on_canvas"
            : supabaseNodes.length > 1
              ? "ambiguous_multiple_supabase_nodes"
              : "vercel_node_missing_project_id",
      });
    }
  }

  if (service === "github") {
    const repoFull = normalizeRepoRef(
      nodeData.githubRepoName as string | undefined,
    );
    if (repoFull) {
      for (const n of merged) {
        if (n.data.provider !== "vercel") continue;
        const vercelRepo = normalizeRepoRef(
          n.data.existing_repo as string | undefined,
        );
        if (vercelRepo && vercelRepo === repoFull) {
          edges.push(makeEdge(newNodeId, n.id, "github", "vercel"));
        }
      }
    }
  }

  if (service === "supabase") {
    const ref = (nodeData.supabaseProjectRef as string | undefined)?.toLowerCase();
    const vercelNodes = merged.filter(
      (n) => n.data.provider === "vercel" && n.data.vercelProjectId,
    );
    // +1 for the Supabase node currently being imported (not yet in `merged`).
    const existingSupabaseCount = merged.filter(
      (n) => n.data.provider === "supabase" && n.data.supabaseProjectRef,
    ).length;
    const isUnambiguous = existingSupabaseCount + 1 === 1;
    if (ref && vercelNodes.length > 0 && isUnambiguous) {
      for (const vNode of vercelNodes) {
        const vercelProjectId = vNode.data.vercelProjectId as string;
        const matched = await hasSupabaseEnvKeys(vercelProjectId);
        if (matched) {
          edges.push(makeEdge(newNodeId, vNode.id, "supabase", "vercel"));
        }
      }
    } else {
      log.info("import.supabase_vercel_match.skipped", {
        reason: !ref
          ? "no_ref_on_new_node"
          : vercelNodes.length === 0
            ? "no_vercel_nodes_on_canvas"
            : "ambiguous_multiple_supabase_nodes",
      });
    }
  }

  return edges;
}

/**
 * Shared tail for POST /:projectId/import-node. Resolves the target
 * environment, checks the canvas lock + node cap, generates the node id and
 * position, persists project_env_node_state (BEFORE the canvas write so the
 * runtime status is never behind the canvas), appends the node to the env
 * canvas under OCC retry, and returns the merged node.
 */
async function finalizeImport(
  c: Context<{ Bindings: Env; Variables: { userId: string } }>,
  projectId: string,
  userId: string,
  service: "github" | "vercel" | "supabase",
  nodeData: Record<string, unknown>,
  envId?: string,
): Promise<Response> {
  // Resolve env: validate caller-supplied envId belongs to this project, else default.
  let environmentId: string;
  if (envId) {
    if (!isUUID(envId)) return c.json({ error: "Invalid envId" }, 400);
    let envRows: Array<{ id: string }>;
    try {
      // scopedByProject verifies project ownership first. If the caller doesn't
      // own projectId, the original code (unscoped envId lookup) fell through to
      // the ownership-checked lock query below and returned "Not found" 404 —
      // map NotOwnedError to the same outcome here instead of surfacing it earlier
      // with a different message.
      const envRes = await scopedByProject(c.env, userId, projectId, "project_environments", {
        query: `id=eq.${envId}&select=id&limit=1`,
      });
      if (!envRes.ok) return c.json({ error: "Failed to resolve environment" }, 500);
      envRows = (await envRes.json()) as Array<{ id: string }>;
    } catch (e) {
      if (e instanceof NotOwnedError) return c.json({ error: "Not found" }, 404);
      throw e;
    }
    if (!envRows[0]) return c.json({ error: "Environment not found" }, 404);
    environmentId = envRows[0].id;
  } else {
    try {
      environmentId = await getDefaultEnvironmentId(c.env, projectId);
    } catch {
      return c.json({ error: "No default environment for project" }, 404);
    }
  }

  // Lock check — mirror PATCH /:projectId/canvas: fail closed if not found.
  const lockRes = await scopedQuery(c.env, userId, "projects", {
    query: `id=eq.${projectId}&select=canvas_locked_by,canvas_locked_at&limit=1`,
  });
  if (!lockRes.ok) return c.json({ error: "Failed to verify ownership" }, 500);
  const lockRows = (await lockRes.json()) as Array<{
    canvas_locked_by: string | null;
    canvas_locked_at: string | null;
  }>;
  if (!lockRows[0]) return c.json({ error: "Not found" }, 404);
  const lock = lockRows[0];
  if (lock.canvas_locked_by && lock.canvas_locked_by !== userId) {
    return c.json(
      {
        error: "Canvas is locked by an active deployment",
        lockedBy: lock.canvas_locked_by,
        lockedAt: lock.canvas_locked_at,
      },
      423,
    );
  }

  // Node-cap check + position calc — read the current env canvas.
  const { canvas } = await loadEnvCanvasWithVersion(c.env, environmentId);
  const existingNodes =
    (canvas.nodes as Array<{
      id: string;
      position?: { x: number; y: number };
    }> | undefined) ?? [];
  if (existingNodes.length >= 50) {
    return c.json({ error: "Canvas node limit reached." }, 400);
  }

  let position: { x: number; y: number };
  if (existingNodes.length === 0) {
    position = { x: 120, y: 120 };
  } else {
    const xs = existingNodes.map((n) => n.position?.x ?? 0);
    const ys = existingNodes.map((n) => n.position?.y ?? 0);
    const maxX = Math.max(...xs);
    const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;
    position = { x: maxX + 220, y: avgY };
  }

  const nodeId = `service-${crypto.randomUUID()}`;

  const authoringData: Record<string, unknown> = {};
  for (const key of IMPORT_AUTHORING_KEYS) {
    if (key in nodeData) authoringData[key] = nodeData[key];
  }
  const runtimeFields: Record<string, unknown> = {};
  for (const key of IMPORT_RUNTIME_KEYS) {
    if (key in nodeData) runtimeFields[key] = nodeData[key];
  }

  // Write node_state FIRST so runtime status is never behind the canvas.
  await setEnvNodeState(c.env, environmentId, nodeId, {
    status: "provisioned",
    provisionedAt: new Date().toISOString(),
    ...runtimeFields,
  });

  const newNode = {
    id: nodeId,
    type: "service",
    position,
    data: authoringData,
  };
  await patchEnvCanvasRetry(
    c.env,
    environmentId,
    (existing) => ({
      ...existing,
      nodes: [
        ...((existing.nodes as unknown[] | undefined) ?? []),
        newNode,
      ],
    }),
    projectId,
  );

  // Auto-connect this node to any existing canvas node it's provably
  // related to (matching GitHub repo, or Vercel env vars referencing this
  // Supabase project) so imported services aren't left disconnected.
  const detectedEdges = await detectImportEdges(
    c,
    userId,
    projectId,
    environmentId,
    service,
    nodeData,
    nodeId,
    existingNodes,
  ).catch(() => [] as ImportEdge[]);

  if (detectedEdges.length > 0) {
    await patchEnvCanvasRetry(
      c.env,
      environmentId,
      (existing) => ({
        ...existing,
        edges: [
          ...((existing.edges as unknown[] | undefined) ?? []),
          ...detectedEdges,
        ],
      }),
      projectId,
    );
  }

  const { version: canvasVersion } = await loadEnvCanvasWithVersion(
    c.env,
    environmentId,
  );

  auditLog(c.env, userId, "node_imported", {
    projectId,
    envId: environmentId,
    nodeId,
    provider: service,
    autoConnectedEdges: detectedEdges.length,
  });

  if (service === "vercel" && typeof nodeData.vercelProjectId === "string") {
    provisioningHooks.monitor
      .start(c.env, projectId, userId, "vercel", nodeData.vercelProjectId)
      .catch(() => {});
  }

  return c.json(
    {
      node: {
        id: nodeId,
        type: "service",
        position,
        data: {
          ...authoringData,
          ...runtimeFields,
          status: "provisioned",
        },
      },
      edges: detectedEdges,
      envId: environmentId,
      canvas_version: canvasVersion,
    },
    201,
  );
}

// PATCH /api/workflows/:projectId/canvas — server-side Zod validation before writing.
// Accepts optional `expectedVersion` for optimistic concurrency control; omit for legacy behaviour.
workflowProvision.patch("/:projectId/canvas", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  if (!isUUID(projectId)) return c.json({ error: "Invalid id" }, 400);

  if (!(await provisioningHooks.rateLimit.check(c.env, userId, "canvas_patch", 120, 60_000))) {
    return c.json({ error: "Too many requests. Please slow down." }, 429);
  }

  const raw = await c.req.json().catch(() => null);
  const parsed = CanvasSchema.safeParse(raw?.canvas ?? raw);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid canvas: " + parsed.error.issues[0]?.message },
      400,
    );
  }

  // Verify ownership and check lock state in one query — fail closed if not found
  const lockRes = await scopedQuery(c.env, userId, "projects", {
    query: `id=eq.${projectId}&select=canvas_locked_by,canvas_locked_at&limit=1`,
  });
  if (!lockRes.ok) return c.json({ error: "Failed to verify ownership" }, 500);
  const lockRows = (await lockRes.json()) as Array<{
    canvas_locked_by: string | null;
    canvas_locked_at: string | null;
  }>;
  if (!lockRows[0]) return c.json({ error: "Not found" }, 404);
  const lock = lockRows[0];
  if (lock.canvas_locked_by && lock.canvas_locked_by !== userId) {
    return c.json(
      {
        error: "Canvas is locked by an active deployment",
        lockedBy: lock.canvas_locked_by,
        lockedAt: lock.canvas_locked_at,
      },
      423,
    );
  }

  const incomingNodes = (parsed.data.nodes as unknown[]) ?? [];
  const isEmpty = incomingNodes.length === 0;
  const canvasData = stripRuntimeFromCanvas(parsed.data) as Record<
    string,
    unknown
  >;

  const expectedVersion =
    typeof raw?.expectedVersion === "number" ? raw.expectedVersion : null;

  if (expectedVersion !== null) {
    const result = await patchCanvasWithVersion(
      c.env,
      projectId,
      expectedVersion,
      (_existing) => {
        if (isEmpty) return { ...canvasData, status: "draft" };
        return canvasData;
      },
      userId,
    );
    if (!result.ok && result.conflict) {
      // Version mismatch — caller should re-fetch and retry
      const current = await loadCanvasWithVersion(c.env, projectId).catch(
        () => null,
      );
      return c.json(
        { error: "canvas_conflict", currentVersion: current?.version ?? null },
        409,
      );
    }
    if (!result.ok) return c.json({ error: "Failed to save canvas" }, 500);

    if (isEmpty) {
      await scopedQuery(c.env, userId, "projects", {
        query: `id=eq.${projectId}`,
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: { status: "draft" },
      });
    }
  } else {
    // Legacy path — no version check
    const patch: Record<string, unknown> = { canvas: canvasData };
    if (isEmpty) patch.status = "draft";
    const res = await scopedQuery(c.env, userId, "projects", {
      query: `id=eq.${projectId}`,
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: patch,
    });
    if (!res.ok) return c.json({ error: "Failed to save canvas" }, 500);
  }

  auditLog(c.env, userId, "canvas_updated", { projectId });
  return c.json({ ok: true });
});

// GET /:projectId/lock-status — returns current provision lock state for the deploy CTA
workflowProvision.get("/:projectId/lock-status", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  if (!isUUID(projectId)) return c.json({ error: "Invalid id" }, 400);

  const res = await scopedQuery(c.env, userId, "projects", {
    query: `id=eq.${projectId}&select=canvas_locked_at,canvas_locked_by,canvas_lock_reason&limit=1`,
  });
  if (!res.ok) return c.json({ error: "Failed to read lock status" }, 500);
  const rows = (await res.json()) as Array<{
    canvas_locked_at: string | null;
    canvas_locked_by: string | null;
    canvas_lock_reason: string | null;
  }>;
  if (!rows[0]) return c.json({ error: "Not found" }, 404);
  const row = rows[0];
  const locked = !!row.canvas_locked_at;
  const ageSeconds = locked
    ? Math.floor(
        (Date.now() - new Date(row.canvas_locked_at!).getTime()) / 1000,
      )
    : 0;
  return c.json({
    locked,
    lockedAt: row.canvas_locked_at,
    lockedBy: row.canvas_locked_by,
    lockReason: row.canvas_lock_reason,
    ageSeconds,
  });
});

// POST /:projectId/force-unlock — owner-only, requires lock to be > 12 minutes old
workflowProvision.post("/:projectId/force-unlock", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  if (!isUUID(projectId)) return c.json({ error: "Invalid id" }, 400);

  const result = await forceUnlock(c.env, projectId, userId);
  if (!result.ok) {
    const status = result.code === "too_recent" ? 429 : 400;
    return c.json({ error: result.error }, status);
  }
  auditLog(c.env, userId, "canvas_force_unlocked", { projectId });
  return c.json({ ok: true });
});

// GET /:projectId/active-session — returns the in-progress stack+session for recovery on page reload
workflowProvision.get("/:projectId/active-session", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  if (!isUUID(projectId)) return c.json({ error: "Invalid id" }, 400);

  const stackRes = await scopedQuery(c.env, userId, "stacks", {
    query: `project_id=eq.${projectId}&status=eq.provisioning&select=id&order=created_at.desc&limit=1`,
  });
  const stackRows = (await stackRes.json()) as Array<{ id: string }>;
  if (!stackRows[0]) return c.json(null, 200);

  const stackId = stackRows[0].id;
  // stackId was just resolved from a stacks query already scoped to this user,
  // so NotOwnedError here is unreachable in practice — still mapped defensively
  // to the same "nothing active" 200 the original code returned on an empty result.
  let sesRows: Array<{ id: string }>;
  try {
    const sesRes = await scopedByStack(c.env, userId, stackId, "provisioning_sessions", {
      query: `status=eq.running&select=id&order=started_at.desc&limit=1`,
    });
    sesRows = (await sesRes.json()) as Array<{ id: string }>;
  } catch (e) {
    if (e instanceof NotOwnedError) return c.json(null, 200);
    throw e;
  }
  if (!sesRows[0]) return c.json(null, 200);

  return c.json({ stackId, sessionId: sesRows[0].id });
});

type SessionStep = {
  service?: string;
  status?: string;
  finished_at?: string;
  output?: Record<string, unknown>;
};

// Self-heal a session the DO left stranded. Provisioning runs detached in the DO
// after its fetch returns, so an isolate eviction can kill finalize (and lose the
// recovery alarm with it), leaving the session at 'running' forever — the deploy
// spinner never stops and config-only GitHub/Resend nodes never flip. This runs
// in a normal Worker request (the frontend's status poll) which can't be evicted,
// so when every step is already terminal but the session is still 'running' past
// a grace window, we write the terminal state the DO never got to. The PATCH is
// gated on status=eq.running so concurrent polls (and a late DO finalize) can't
// double-apply — only the first writer proceeds to the follow-up work.
async function finalizeStrandedSession(
  env: Env,
  session: {
    id: string;
    stack_id: string;
    steps: SessionStep[];
  },
  projectId: string,
  environmentId: string | null,
  userId: string,
): Promise<"success" | "failed"> {
  const anyFailed = session.steps.some((s) => s.status === "error");
  const now = new Date().toISOString();

  if (anyFailed) {
    // provisioning_sessions has no user_id — scoped via the parent stack, which
    // the caller (GET /:projectId/session/:sessionId) already resolved through a
    // user-owned stack join. NotOwnedError here would be unreachable in practice;
    // it propagates to the caller's existing `.catch(() => null)` best-effort guard.
    const r = await scopedByStack(env, userId, session.stack_id, "provisioning_sessions", {
      query: `id=eq.${session.id}&status=eq.running`,
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: {
        status: "failed",
        finished_at: now,
        error_message: "A provisioning step failed.",
      },
    });
    const won = r.ok && ((await r.json()) as unknown[]).length > 0;
    if (won) {
      await scopedQuery(env, userId, "stacks", {
        query: `id=eq.${session.stack_id}`,
        method: "PATCH",
        body: { status: "error" },
      }).catch(() => {});
      await scopedQuery(env, userId, "projects", {
        query: `id=eq.${projectId}`,
        method: "PATCH",
        body: { status: "error" },
      }).catch(() => {});
    }
    return "failed";
  }

  const r = await scopedByStack(env, userId, session.stack_id, "provisioning_sessions", {
    query: `id=eq.${session.id}&status=eq.running`,
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: { status: "success", finished_at: now },
  });
  const won = r.ok && ((await r.json()) as unknown[]).length > 0;
  if (won) {
    await scopedQuery(env, userId, "stacks", {
      query: `id=eq.${session.stack_id}`,
      method: "PATCH",
      body: { status: "ready" },
    }).catch(() => {});
    await scopedQuery(env, userId, "projects", {
      query: `id=eq.${projectId}`,
      method: "PATCH",
      body: { status: "active" },
    }).catch(() => {});
    // Flip config-only GitHub/Resend nodes to provisioned (persisted, so a reload keeps them).
    await markConfigOnlyNodesProvisioned(
      env,
      projectId,
      environmentId ?? undefined,
    ).catch(() => {});
    // Configure Supabase Auth site_url from the step outputs — the DO's
    // postConfigureAuth never ran, so without this the project keeps its default
    // localhost:3000 site URL (broken email confirmation / redirects).
    try {
      const siteUrl = session.steps
        .map(
          (s) =>
            (s.output?.vercel_project_url as string | undefined) ??
            (s.output?.FRONTEND_URL as string | undefined),
        )
        .find(Boolean);
      const refs = session.steps
        .map((s) => s.output?.supabase_project_ref as string | undefined)
        .filter((x): x is string => Boolean(x));
      if (siteUrl && refs.length > 0) {
        const token = await getUserToken(env, userId, "supabase");
        for (const ref of refs) {
          await configureSupabaseAuth(token, ref, { siteUrl }).catch(() => {});
        }
      }
    } catch {
      /* best-effort — never block the status response */
    }
  }
  return "success";
}

workflowProvision.get("/:projectId/session/:sessionId", async (c) => {
  const userId = c.get("userId");
  const sessionId = c.req.param("sessionId");
  const projectId = c.req.param("projectId");
  if (!isUUID(sessionId) || !isUUID(projectId))
    return c.json({ error: "Invalid id" }, 400);

  // provisioning_sessions has no user_id — ownership runs through its parent
  // stack. The original code did this as ONE round trip via a `stacks!inner(...)`
  // embedded join with `stacks.user_id=eq.${userId}` baked into the filter; the
  // tenancy helpers don't support embedded-resource joins, so this is split into
  // an unscoped id lookup (used only to learn stack_id — its row is never
  // returned to the caller) followed by the real, ownership-enforced fetch
  // through scopedByStack. Net behavior is identical: not-owned and not-found
  // both still produce "Not found" 404.
  const idRes = await systemQuery(
    c.env,
    `provisioning_sessions?id=eq.${sessionId}&select=id,stack_id&limit=1`,
  );
  const idRows = (await idRes.json()) as Array<{ id: string; stack_id: string }>;
  if (!idRows[0]) return c.json({ error: "Not found" }, 404);
  const stackId = idRows[0].stack_id;

  let rows: Array<Record<string, unknown>>;
  try {
    const res = await scopedByStack(c.env, userId, stackId, "provisioning_sessions", {
      query:
        `id=eq.${sessionId}` +
        `&select=id,stack_id,status,total_steps,current_step,steps,started_at,finished_at,error_message&limit=1`,
    });
    rows = (await res.json()) as Array<Record<string, unknown>>;
  } catch (e) {
    if (e instanceof NotOwnedError) return c.json({ error: "Not found" }, 404);
    throw e;
  }
  if (!rows[0]) return c.json({ error: "Not found" }, 404);
  const session = rows[0];

  // Self-heal a DO-stranded session (see finalizeStrandedSession). Only when the
  // session is still 'running' but every step is already terminal AND the last
  // step finished > 30s ago — the grace window avoids racing a DO finalize that's
  // legitimately still in flight.
  const steps = Array.isArray(session.steps)
    ? (session.steps as SessionStep[])
    : [];
  if (
    session.status === "running" &&
    steps.length > 0 &&
    steps.every((s) => s.status === "success" || s.status === "error")
  ) {
    const lastFinished = Math.max(
      0,
      ...steps.map((s) => (s.finished_at ? Date.parse(s.finished_at) : 0)),
    );
    if (lastFinished > 0 && Date.now() - lastFinished > 30_000) {
      // environment_id previously came off the joined `stacks` row; fetch it
      // directly (only needed on this rare self-heal path) now that ownership
      // of `stackId` is already established above.
      let environmentId: string | null = null;
      const stackEnvRes = await scopedQuery(c.env, userId, "stacks", {
        query: `id=eq.${stackId}&select=environment_id&limit=1`,
      }).catch(() => null);
      if (stackEnvRes?.ok) {
        const stackEnvRows = (await stackEnvRes.json()) as Array<{
          environment_id: string | null;
        }>;
        environmentId = stackEnvRows[0]?.environment_id ?? null;
      }
      const outcome = await finalizeStrandedSession(
        c.env,
        { id: sessionId, stack_id: stackId, steps },
        projectId,
        environmentId,
        userId,
      ).catch(() => null);
      if (outcome) {
        session.status = outcome;
        session.finished_at = new Date().toISOString();
        createLogger({ route: "workflowProvision" }).info(
          "session.self_healed",
          { sessionId, outcome },
        );
      }
    }
  }

  return c.json(session);
});

// POST /:projectId/session/:sessionId/project — on-demand projection of events → session steps
workflowProvision.post("/:projectId/session/:sessionId/project", async (c) => {
  const userId = c.get("userId");
  const { projectId, sessionId } = c.req.param();
  if (!isUUID(projectId) || !isUUID(sessionId))
    return c.json({ error: "Invalid id" }, 400);

  // Ownership check via stack join — same two-step split as GET /session/:sessionId
  // above (unscoped id→stack_id lookup, then ownership-enforced scopedByStack fetch).
  const idRes = await systemQuery(
    c.env,
    `provisioning_sessions?id=eq.${sessionId}&select=id,stack_id&limit=1`,
  );
  const idRows = (await idRes.json()) as Array<{ id: string; stack_id: string }>;
  if (!idRows[0]) return c.json({ error: "Not found" }, 404);

  try {
    const res = await scopedByStack(c.env, userId, idRows[0].stack_id, "provisioning_sessions", {
      query: `id=eq.${sessionId}&select=id&limit=1`,
    });
    const rows = (await res.json()) as unknown[];
    if (!rows[0]) return c.json({ error: "Not found" }, 404);
  } catch (e) {
    if (e instanceof NotOwnedError) return c.json({ error: "Not found" }, 404);
    throw e;
  }

  await projectSession(c.env, sessionId);
  return c.json({ ok: true });
});

const VALID_DEPROVISION_SERVICES = [
  "vercel",
  "supabase",
  "resend",
  "github",
  "cloudflare-workers",
  "cloudflare-r2",
] as const;

workflowProvision.delete("/:projectId/nodes/:nodeId", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    service: string;
    stackId?: string;
    imported?: boolean;
    keepResource?: boolean;
    serviceIds: {
      vercelProjectId?: string;
      supabaseProjectRef?: string;
      githubRepoName?: string;
      cfWorkerName?: string;
      cfBucketName?: string;
      cloudflareAccountId?: string;
    };
  }>();

  const { service, stackId: rawStackId, serviceIds, imported, keepResource } = body;
  if (!(VALID_DEPROVISION_SERVICES as readonly string[]).includes(service)) {
    return c.json({ error: "Invalid service" }, 400);
  }

  const EXTERNAL_ID_RE = /^[A-Za-z0-9_\-]{1,128}$/;
  const projectId = c.req.param("projectId");
  const nodeId = c.req.param("nodeId");
  if (!isUUID(projectId)) return c.json({ error: "Invalid project" }, 400);

  // Ownership is anchored on the PROJECT (the board the user is editing), not on
  // a stack. A stackId frequently can't be resolved — config-only nodes (GitHub)
  // and services skipped on an incremental deploy never get a stack_services
  // row, and nodes don't persist stackId to the canvas — yet the user must still
  // be able to delete them. Verify the project belongs to the caller, then read
  // the resource's real ID from the server-side canvas.
  const projRes = await scopedQuery(c.env, userId, "projects", {
    query: `id=eq.${projectId}&select=id&limit=1`,
  });
  const projRows = projRes.ok
    ? ((await projRes.json()) as Array<{ id: string }>)
    : [];
  if (!projRows.length) return c.json({ error: "Project not found" }, 404);

  // Resolve a stackId when possible — used ONLY for best-effort DB cleanup below
  // (deleting stack_services rows / an emptied stack). Never a hard requirement.
  let stackId: string | null = isUUID(rawStackId ?? "")
    ? (rawStackId ?? null)
    : null;
  if (!stackId) {
    // Validate format strictly to prevent PostgREST injection before interpolation.
    const extId =
      serviceIds.vercelProjectId ??
      serviceIds.supabaseProjectRef ??
      serviceIds.githubRepoName ??
      serviceIds.cfWorkerName ??
      serviceIds.cfBucketName;
    if (extId && EXTERNAL_ID_RE.test(extId)) {
      // stack_services has no user_id and we don't yet know which stack to scope
      // by (that's exactly what we're resolving) — the original code did this as
      // one round trip via a `stacks!inner(...)` embedded join filtered on
      // `stacks.user_id=eq.${userId}`. The tenancy helpers don't support
      // embedded-resource joins, so this is split into an unscoped candidate
      // lookup by external_id followed by an ownership check per candidate via
      // scopedQuery on `stacks`, taking the first owned match — same net result
      // as the original single-query `limit=1` join.
      const ssRes = await systemQuery(
        c.env,
        `stack_services?external_id=eq.${encodeURIComponent(extId)}&select=stack_id`,
      );
      if (ssRes.ok) {
        const ssRows = (await ssRes.json()) as Array<{ stack_id: string }>;
        for (const row of ssRows) {
          const ownRes = await scopedQuery(c.env, userId, "stacks", {
            query: `id=eq.${row.stack_id}&select=id&limit=1`,
          });
          const ownRows = ownRes.ok ? ((await ownRes.json()) as unknown[]) : [];
          if (ownRows.length > 0) {
            stackId = row.stack_id;
            break;
          }
        }
      }
    }
  }
  // A supplied/resolved stackId must belong to THIS project — otherwise ignore it
  // (don't block the delete, just skip its cleanup). Defense in depth.
  if (stackId) {
    const ownerRes = await scopedQuery(c.env, userId, "stacks", {
      query: `id=eq.${stackId}&select=project_id&limit=1`,
    });
    const ownerRows = ownerRes.ok
      ? ((await ownerRes.json()) as Array<{ project_id: string | null }>)
      : [];
    if (
      !ownerRows.length ||
      (ownerRows[0].project_id && ownerRows[0].project_id !== projectId)
    ) {
      stackId = null;
    }
  }

  // Load the persisted canvas once — the trusted server-side source for the
  // node's provisioned resource IDs and imported flag. Never trust
  // client-supplied serviceIds for the actual deprovision call.
  let canvasNodeData: Record<string, unknown> | null = null;
  try {
    const { canvas } = await loadCanvasWithVersion(c.env, projectId);
    const node = (
      (canvas as { nodes?: Array<{ id: string; data?: Record<string, unknown> }> })
        ?.nodes ?? []
    ).find((n) => n.id === nodeId);
    canvasNodeData = node?.data ?? null;
  } catch {
    /* canvas unreadable — deprovision may be skipped, node removal still runs */
  }

  // Imported resources are pre-existing — never delete them from the provider,
  // even if the client omitted the flag.
  const isImported = imported === true || canvasNodeData?.imported === true;

  // Trusted external_id: prefer the stack_services row; fall back to the canvas
  // node's provisioned resource ID (still server-side, so not client-trusted).
  let trustedExternalId: string | null = null;
  if (!isImported && !keepResource) {
    if (stackId) {
      // stackId was already verified above to belong to this project/user.
      try {
        const ssRes = await scopedByStack(c.env, userId, stackId, "stack_services", {
          query: `service_type=eq.${encodeURIComponent(service)}&select=external_id&limit=1`,
        });
        if (ssRes.ok) {
          const ssRows = (await ssRes.json()) as Array<{ external_id: string | null }>;
          trustedExternalId = ssRows[0]?.external_id ?? null;
        }
      } catch (e) {
        if (!(e instanceof NotOwnedError)) throw e;
        // unreachable in practice (stackId already ownership-verified above) —
        // fall through with trustedExternalId left null, same as the original
        // code's !ssRes.ok no-op branch.
      }
    }
    if (!trustedExternalId && canvasNodeData) {
      const CANVAS_ID_KEY: Record<string, string> = {
        vercel: "vercelProjectId",
        supabase: "supabaseProjectRef",
        github: "githubRepoName",
        "cloudflare-workers": "cfWorkerNameProvisioned",
        "cloudflare-r2": "cfBucketNameProvisioned",
      };
      const fromCanvas = canvasNodeData[CANVAS_ID_KEY[service] ?? ""] as
        | string
        | undefined;
      if (fromCanvas && EXTERNAL_ID_RE.test(fromCanvas)) {
        trustedExternalId = fromCanvas;
      }
    }
  }

  if (!isImported && !keepResource) {
    if (!trustedExternalId) {
      // No resource ID in stack_services OR the canvas node — nothing safe to
      // deprovision. Skip the cloud call (same as "imported") and only clean up
      // Leenar's own DB/canvas state below.
      log.warn("node_delete.no_trusted_external_id", { stackId, service });
    } else {
      try {
        if (service === "vercel") {
          const token = await getUserToken(c.env, userId, "vercel");
          await deprovisionVercel(token, {
            vercel_project_id: trustedExternalId,
          });
        } else if (service === "supabase") {
          const token = await getUserToken(c.env, userId, "supabase");
          await deprovisionSupabase(token, {
            supabase_project_ref: trustedExternalId,
          });
        } else if (service === "cloudflare-workers") {
          const token = await getUserToken(c.env, userId, "cloudflare");
          const accountId = await getAccountId(token);
          await deprovisionCloudflareWorker(
            token,
            accountId,
            trustedExternalId,
          );
        } else if (service === "cloudflare-r2") {
          const token = await getUserToken(c.env, userId, "cloudflare");
          const accountId = await getAccountId(token);
          await deprovisionR2Bucket(token, accountId, trustedExternalId);
        }
      } catch (e: unknown) {
        log.error("node_delete.failed", {
          err: e instanceof Error ? e.message : String(e),
        });
        return c.json(
          { error: "Failed to remove resource. Please try again." },
          500,
        );
      }
    }
  }

  try {
    // Clean up DB records for this service. stackId (when set) was already
    // verified above to belong to this project/user, so scopedByStack's
    // ownership re-check is defense-in-depth, not a new failure mode — any
    // NotOwnedError here is unreachable in practice and falls into the
    // existing catch below, same as any other DB failure in this block.
    if (stackId) {
      // Delete the specific stack_service row
      await scopedByStack(c.env, userId, stackId, "stack_services", {
        query: `service_type=eq.${encodeURIComponent(service)}`,
        method: "DELETE",
      });

      // If no more services in this stack, delete the stack itself
      const remainingRes = await scopedByStack(c.env, userId, stackId, "stack_services", {
        query: `select=id&limit=1`,
      });
      const remainingRows = (await remainingRes.json()) as Array<unknown>;
      if (remainingRows.length === 0) {
        await scopedByStack(c.env, userId, stackId, "provisioning_sessions", {
          method: "DELETE",
        });
        await scopedQuery(c.env, userId, "stacks", {
          query: `id=eq.${stackId}`,
          method: "DELETE",
        });
      }
    }

    // Remove the node from the main canvas JSONB and all env canvases immediately
    // so switching environments doesn't bring the deleted node back.
    if (nodeId) {
      const removeNode = (canvas: Record<string, unknown>) => {
        const nodes = (canvas.nodes as Array<{ id: string }> | undefined) ?? [];
        const edges = (
          canvas.edges as Array<{ source: string; target: string }> | undefined
        ) ?? [];
        return {
          ...canvas,
          nodes: nodes.filter((n) => n.id !== nodeId),
          edges: edges.filter(
            (e) => e.source !== nodeId && e.target !== nodeId,
          ),
        };
      };

      // Patch projects.canvas and all env canvases via waitUntil so the CF
      // Worker context stays alive past the response.
      const canvasPatch = Promise.all([
        loadCanvasWithVersion(c.env, projectId)
          .then(({ version }) =>
            patchCanvasWithVersion(c.env, projectId, version, removeNode, userId),
          )
          .catch(() => {}),
        scopedByProject(c.env, userId, projectId, "project_environments", {
          query: `select=id`,
        })
          .then(async (envsRes) => {
            if (!envsRes.ok) return;
            const envs = (await envsRes.json()) as Array<{ id: string }>;
            const results = await Promise.allSettled(
              envs.map((e) =>
                patchEnvCanvasRetry(c.env, e.id, removeNode, projectId),
              ),
            );
            for (const r of results) {
              if (r.status === "rejected") {
                log.error("node_delete.env_canvas_patch_failed", {
                  projectId,
                  nodeId,
                  err: r.reason instanceof Error ? r.reason.message : String(r.reason),
                });
              }
            }
          })
          .catch(() => {}),
      ]);
      c.executionCtx.waitUntil(canvasPatch);
    }

    return c.json({ ok: true });
  } catch (e: unknown) {
    log.error("node_delete.failed", {
      err: e instanceof Error ? e.message : String(e),
    });
    return c.json(
      { error: "Failed to remove resource. Please try again." },
      500,
    );
  }
});

// DELETE /api/workflows/:projectId/nodes/:nodeId/canvas
// Removes an unprovisioned node from projects.canvas and all project_environments.canvas
// without touching any cloud resources. Used when the node has no stackId.
workflowProvision.delete("/:projectId/nodes/:nodeId/canvas", async (c) => {
  const userId = c.get("userId");
  const { projectId, nodeId } = c.req.param();
  if (!isUUID(projectId) || !nodeId)
    return c.json({ error: "Invalid id" }, 400);

  const ownerRes = await scopedQuery(c.env, userId, "projects", {
    query: `id=eq.${projectId}&select=id&limit=1`,
  });
  if (!ownerRes.ok) return c.json({ error: "Failed to verify ownership" }, 500);
  const ownerRows = (await ownerRes.json()) as Array<{ id: string }>;
  if (!ownerRows.length) return c.json({ error: "Not found" }, 404);

  const removeNode = (canvas: Record<string, unknown>) => {
    const nodes = (canvas.nodes as Array<{ id: string }> | undefined) ?? [];
    const edges = (
      canvas.edges as Array<{ source: string; target: string }> | undefined
    ) ?? [];
    return {
      ...canvas,
      nodes: nodes.filter((n) => n.id !== nodeId),
      edges: edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    };
  };

  const canvasPatch = Promise.all([
    loadCanvasWithVersion(c.env, projectId)
      .then(({ version }) =>
        patchCanvasWithVersion(c.env, projectId, version, removeNode, userId),
      )
      .catch(() => {}),
    scopedByProject(c.env, userId, projectId, "project_environments", {
      query: `select=id`,
    })
      .then(async (envsRes) => {
        if (!envsRes.ok) return;
        const envs = (await envsRes.json()) as Array<{ id: string }>;
        const results = await Promise.allSettled(
          envs.map((e) => patchEnvCanvasRetry(c.env, e.id, removeNode, projectId)),
        );
        for (const r of results) {
          if (r.status === "rejected") {
            log.error("node_delete_canvas.env_canvas_patch_failed", {
              projectId,
              nodeId,
              err: r.reason instanceof Error ? r.reason.message : String(r.reason),
            });
          }
        }
      })
      .catch(() => {}),
  ]);
  c.executionCtx.waitUntil(canvasPatch);

  return c.json({ ok: true });
});

// GET /api/workflows/:projectId/resource-health
// Checks whether provisioned cloud resources (Vercel projects, Supabase projects) still exist.
// Uses the user's own OAuth tokens — never service account keys.
workflowProvision.get("/:projectId/resource-health", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  if (!isUUID(projectId)) return c.json({ error: "Invalid id" }, 400);

  // Ownership check — only this user's workflow
  const wfRes = await scopedQuery(c.env, userId, "projects", {
    query: `id=eq.${projectId}&select=canvas&limit=1`,
  });
  const wfRows = (await wfRes.json()) as Array<{ canvas: unknown }>;
  if (!wfRows[0]) return c.json({ error: "Not found" }, 404);

  const canvas = wfRows[0].canvas as {
    nodes?: Array<Record<string, unknown>>;
  } | null;
  const nodes = Array.isArray(canvas?.nodes) ? canvas.nodes : [];

  const checks = nodes
    .filter((node) => {
      const data = (node.data ?? {}) as Record<string, string>;
      return (
        node.id &&
        data.status === "provisioned" &&
        ((data.provider === "vercel" && data.vercelProjectId) ||
          (data.provider === "supabase" && data.supabaseProjectRef))
      );
    })
    .map(async (node): Promise<{ nodeId: string; alive: boolean } | null> => {
      const data = (node.data ?? {}) as Record<string, string>;
      const nodeId = node.id as string;
      try {
        if (data.provider === "vercel") {
          const token = await getUserToken(c.env, userId, "vercel");
          const res = await fetch(
            `https://api.vercel.com/v9/projects/${data.vercelProjectId}`,
            {
              headers: { Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(10_000),
            },
          );
          return { nodeId, alive: res.status !== 404 };
        } else {
          const token = await getUserToken(c.env, userId, "supabase");
          const res = await fetch(
            `https://api.supabase.com/v1/projects/${data.supabaseProjectRef}`,
            {
              headers: { Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(10_000),
            },
          );
          return { nodeId, alive: res.status !== 404 };
        }
      } catch {
        return null; // No token or network error — skip, don't report as deleted
      }
    });

  const settled = await Promise.allSettled(checks);
  const results = settled
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter((r): r is { nodeId: string; alive: boolean } => r !== null);

  return c.json({ results });
});

// GET /:projectId/deployments — list past deployments for a project, newest first
workflowProvision.get("/:projectId/deployments", async (c) => {
  const userId = c.get("userId");
  const { projectId } = c.req.param();
  if (!isUUID(projectId)) return c.json({ error: "invalid projectId" }, 400);

  // Ownership check
  const projRes = await scopedQuery(c.env, userId, "projects", {
    query: `id=eq.${projectId}&select=id&limit=1`,
  });
  if (!projRes.ok) return c.json({ error: "failed to verify ownership" }, 500);
  const projRows = await projRes.json<any[]>();
  if (!projRows.length) return c.json({ error: "not found" }, 404);

  // project_deployments has no user_id — projectId ownership already verified above.
  let deployments: any[] = [];
  try {
    const res = await scopedByProject(c.env, userId, projectId, "project_deployments", {
      query: `select=id,status,started_at,finished_at,provider_refs&order=started_at.desc`,
    });
    if (res.ok) deployments = await res.json<any[]>();
  } catch (e) {
    if (!(e instanceof NotOwnedError)) throw e;
    // unreachable (ownership already verified above) — same empty-list fallback
    // the original code used for a failed/!ok fetch.
  }
  return c.json({ deployments: Array.isArray(deployments) ? deployments : [] });
});

// POST /:projectId/deployments/:deploymentId/rollback
workflowProvision.post(
  "/:projectId/deployments/:deploymentId/rollback",
  async (c) => {
    const userId = c.get("userId");
    const { projectId, deploymentId } = c.req.param();
    if (!isUUID(projectId) || !isUUID(deploymentId))
      return c.json({ error: "invalid id" }, 400);

    if (c.req.header("X-Confirm-Rollback") !== "true") {
      return c.json({ error: "missing X-Confirm-Rollback: true header" }, 400);
    }

    // Ownership check — executeRollback does not do this
    const projRes = await scopedQuery(c.env, userId, "projects", {
      query: `id=eq.${projectId}&select=id&limit=1`,
    });
    if (!projRes.ok)
      return c.json({ error: "failed to verify ownership" }, 500);
    const projRows = await projRes.json<any[]>();
    if (!projRows.length) return c.json({ error: "not found" }, 404);

    const result = await executeRollback(
      c.env,
      projectId,
      deploymentId,
      userId,
    );

    if (result.reason === "locked") {
      return c.json(
        { error: "Canvas is locked (deploy in progress). Try again shortly." },
        409,
      );
    }
    if (result.reason === "not_found") {
      return c.json(
        { error: "deployment not found or not a successful deployment" },
        404,
      );
    }

    await auditLog(c.env, userId, "deploy_rolled_back", {
      projectId,
      deploymentId,
      canvasRestored: result.canvasRestored,
      results: result.results,
      source: "api",
    });

    return c.json({
      ok: result.ok,
      canvasRestored: result.canvasRestored,
      results: result.results,
      ...(result.warnings?.length ? { warnings: result.warnings } : {}),
    });
  },
);

// Delete a workflow and deprovision all its cloud resources.
// Requires X-Confirm-Delete: true header as a second gate against accidental deletion.
workflowProvision.delete("/:projectId", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  if (!isUUID(projectId)) return c.json({ error: "Invalid id" }, 400);

  if (c.req.header("X-Confirm-Delete") !== "true") {
    return c.json({ error: "Missing confirmation header" }, 400);
  }

  const keepResources = c.req.query("keepResources") === "true";

  // Read the canvas + use_events flag
  const wfRes = await scopedQuery(c.env, userId, "projects", {
    query: `id=eq.${projectId}&select=canvas,use_events&limit=1`,
  });
  const wfRows = (await wfRes.json()) as Array<{
    canvas: unknown;
    use_events: boolean;
  }>;
  if (!wfRows[0]) return c.json({ error: "Workflow not found" }, 404);

  const useEvents = wfRows[0].use_events ?? false;

  // When use_events=true, build resource list from events (immune to canvas edits).
  // Fall back to canvas walk for older workflows.
  let eventResources: Awaited<ReturnType<typeof getProvisionedResources>> = [];
  if (useEvents) {
    // Find the last ready stack for this workflow
    const stackRes = await scopedQuery(c.env, userId, "stacks", {
      query: `project_id=eq.${projectId}&status=eq.ready&select=id&order=created_at.desc&limit=1`,
    });
    if (stackRes.ok) {
      const stackRows = (await stackRes.json()) as Array<{ id: string }>;
      if (stackRows[0]) {
        eventResources = await getProvisionedResources(
          c.env,
          stackRows[0].id,
        ).catch(() => []);
      }
    }
  }

  const canvas = wfRows[0].canvas as {
    nodes?: Array<Record<string, unknown>>;
  } | null;
  const nodes = canvas?.nodes ?? [];

  // Deprovision each cloud resource — best effort (don't abort on partial failure)
  // Check for resource IDs directly rather than relying on status, so partially-provisioned
  // nodes (e.g. status='error') that still have a cloud resource also get cleaned up.
  const errors: string[] = [];
  const getToken = makeTokenCache(c.env, userId);

  // When use_events=true, deprovision from event-sourced resource list.
  // Otherwise (and always for services not in the event list), walk the canvas.
  if (!keepResources) {
    if (useEvents && eventResources.length > 0) {
      for (const resource of eventResources) {
        try {
          if (resource.service === "vercel") {
            const token = await getToken("vercel");
            await deprovisionVercel(token, {
              vercel_project_id: resource.resourceId,
            });
          } else if (resource.service === "supabase") {
            const token = await getToken("supabase");
            await deprovisionSupabase(token, {
              supabase_project_ref: resource.resourceId,
            });
          } else if (resource.service === "cloudflare-workers") {
            const token = await getToken("cloudflare");
            const accountId = await getAccountId(token);
            await deprovisionCloudflareWorker(
              token,
              accountId,
              resource.resourceId,
            );
          } else if (resource.service === "cloudflare-r2") {
            const token = await getToken("cloudflare");
            const accountId = await getAccountId(token);
            await deprovisionR2Bucket(token, accountId, resource.resourceId);
          }
        } catch (e) {
          log.error("workflow_delete.deprovision_error", {
            service: resource.service,
            err: e instanceof Error ? e.message : String(e),
          });
          errors.push(`${resource.service}: resource removal failed`);
        }
      }
    } else {
      for (const node of nodes) {
        const data = (node.data ?? {}) as Record<string, unknown>;
        // Skip deprovision for imported nodes — they are pre-existing resources
        // that Leenar did not create and must not delete.
        if (data.imported) continue;
        try {
          if (data.provider === "vercel" && data.vercelProjectId) {
            const token = await getToken("vercel");
            await deprovisionVercel(token, {
              vercel_project_id: data.vercelProjectId as string,
            });
          } else if (data.provider === "supabase" && data.supabaseProjectRef) {
            const token = await getToken("supabase");
            await deprovisionSupabase(token, {
              supabase_project_ref: data.supabaseProjectRef as string,
            });
          } else if (data.provider === "cloudflare") {
            const token = await getToken("cloudflare");
            const accountId = await getAccountId(token);
            if (data.cfWorkerNameProvisioned) {
              await deprovisionCloudflareWorker(
                token,
                accountId,
                data.cfWorkerNameProvisioned as string,
              );
            }
            if (data.cfBucketNameProvisioned) {
              await deprovisionR2Bucket(
                token,
                accountId,
                data.cfBucketNameProvisioned as string,
              );
            }
          }
        } catch (e) {
          log.error("workflow_delete.deprovision_error", {
            provider: data.provider,
            err: e instanceof Error ? e.message : String(e),
          });
          errors.push(`${data.provider ?? "unknown"}: resource removal failed`);
        }
      }
    }
  }

  // Delete workflow record (cascades to deployments, provisioning_sessions)
  const delRes = await scopedQuery(c.env, userId, "projects", {
    query: `id=eq.${projectId}`,
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  if (!delRes.ok) {
    const errText = await delRes.text().catch(() => String(delRes.status));
    log.error("workflow_delete.db_failed", { errText });
    return c.json(
      { error: "Failed to delete workflow. Please try again." },
      500,
    );
  }

  // Stop incident monitor for this workflow (best-effort)
  provisioningHooks.monitor.stop(c.env, projectId).catch(() => {});

  auditLog(c.env, userId, "workflow_deleted", { projectId });
  log.info("workflow_delete.done", {
    projectId,
    deprovisionErrors: errors.length,
  });
  return c.json({ ok: true, ...(errors.length ? { warnings: errors } : {}) });
});

// ── from-repo helpers (exported for unit tests) ─────────────────────────────

export function parseGitHubUrl(
  url: string,
): { owner: string; repo: string } | null {
  const match = url.match(
    /github\.com[/:]([^/]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?].*)?$/,
  );
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

export type RepoSvcType = "github" | "vercel" | "supabase" | "resend";

export interface DetectedServices {
  services: RepoSvcType[];
  connections: Array<{ from_type: RepoSvcType; to_type: RepoSvcType }>;
}

export function detectServicesFromDeps(
  deps: string[],
  envKeys: string[] = [],
  rootFiles: string[] = [],
): DetectedServices {
  const SUPABASE_ENV_RE = /^(NEXT_PUBLIC_|VITE_)?SUPABASE_/;
  const RESEND_ENV_RE = /^RESEND_/;

  // Vercel: explicit signal required — vercel.json in root OR @vercel/* package
  // (generic frameworks like express/next are NOT Vercel-specific)
  const hasVercel =
    rootFiles.includes("vercel.json") ||
    deps.some((d) => d === "@vercel/node" || d.startsWith("@vercel/")) ||
    envKeys.some((k) => k === "VERCEL_URL" || k === "VERCEL_TOKEN") ||
    // Next.js + Supabase combos are almost always Vercel-hosted
    (deps.includes("next") &&
      deps.some((d) =>
        [
          "@supabase/supabase-js",
          "@supabase/ssr",
          "@supabase/auth-helpers-nextjs",
        ].includes(d),
      ));

  // Fallback: if there's a deployable frontend framework but no other host signal,
  // assume Vercel (most common default).
  // Vite is included because it's almost exclusively used for frontend SPAs.
  const hasFrontendFramework = deps.some((d) =>
    [
      "next",
      "nuxt",
      "@remix-run/react",
      "react-scripts",
      "gatsby",
      "@sveltejs/kit",
      "astro",
      "vite",
    ].includes(d),
  );

  const hasSupabase =
    deps.some((d) =>
      [
        "@supabase/supabase-js",
        "@supabase/ssr",
        "@supabase/auth-helpers-nextjs",
      ].includes(d),
    ) || envKeys.some((k) => SUPABASE_ENV_RE.test(k));

  const hasResend =
    deps.some((d) => ["resend", "@resend/node"].includes(d)) ||
    envKeys.some((k) => RESEND_ENV_RE.test(k));

  // Use Vercel only if explicitly signaled OR if there's a frontend framework with no other host
  const useVercel = hasVercel || hasFrontendFramework;

  const services: RepoSvcType[] = ["github"];
  if (hasSupabase) services.push("supabase");
  if (useVercel) services.push("vercel");
  if (hasResend) services.push("resend");

  const connections: Array<{ from_type: RepoSvcType; to_type: RepoSvcType }> =
    [];
  if (hasSupabase && useVercel)
    connections.push({ from_type: "supabase", to_type: "vercel" });
  if (useVercel) connections.push({ from_type: "github", to_type: "vercel" });
  if (hasResend && useVercel)
    connections.push({ from_type: "resend", to_type: "vercel" });
  else if (hasResend && hasSupabase)
    connections.push({ from_type: "resend", to_type: "supabase" });

  return { services, connections };
}

export function sanitizeProjectName(
  raw: string | undefined,
  fallback: string,
): string {
  return (
    raw
      ?.replace(/[^a-z0-9-]/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || fallback
  );
}

// POST /api/workflows/from-repo — analyze a GitHub repo and suggest a Leenar canvas
// Fetches package.json + .env.example to detect which services to provision.
workflowProvision.post("/from-repo", async (c) => {
  const userId = c.get("userId");

  // Rate limit: 20 analyses per 5 minutes per user (prevents GitHub token abuse)
  if (!(await provisioningHooks.rateLimit.check(c.env, userId, "from-repo", 20, 5 * 60_000))) {
    return c.json(
      { error: "Too many requests. Please wait a few minutes." },
      429,
    );
  }

  const body = await c.req.json<{ repoUrl?: string }>().catch(() => ({}));
  const repoUrl = (body as { repoUrl?: string }).repoUrl;
  if (!repoUrl || typeof repoUrl !== "string" || repoUrl.length > 256)
    return c.json({ error: "repoUrl required" }, 400);

  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) return c.json({ error: "Invalid GitHub repo URL" }, 400);
  const { owner, repo } = parsed;

  // Strict alphanumeric validation — blocks path traversal and injection
  const SAFE_SEGMENT = /^[a-zA-Z0-9_.-]+$/;
  if (!SAFE_SEGMENT.test(owner) || !SAFE_SEGMENT.test(repo))
    return c.json({ error: "Invalid GitHub repo URL" }, 400);

  // Use the user's GitHub token so private repos work too
  let ghToken: string | null = null;
  try {
    ghToken = await getUserToken(c.env, userId, "github");
  } catch {
    /* not connected — fall back to unauthenticated */
  }
  const ghHeaders: Record<string, string> = { "User-Agent": "Leenar/1.0" };
  if (ghToken) ghHeaders["Authorization"] = `Bearer ${ghToken}`;

  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;
  const apiHeaders = {
    ...ghHeaders,
    Accept: "application/vnd.github.v3+json",
  };

  // Single request: get repo info (default branch) + root contents in parallel
  const [repoInfoRes, rootContentsRes] = await Promise.all([
    fetch(apiBase, { headers: apiHeaders }),
    fetch(`${apiBase}/contents/`, { headers: apiHeaders }),
  ]);

  const repoInfo = repoInfoRes.ok
    ? ((await repoInfoRes.json()) as { default_branch?: string })
    : null;
  const defaultBranch = repoInfo?.default_branch ?? "main";

  type GhContentItem = { name: string; type: string };
  const rootItems: GhContentItem[] = rootContentsRes.ok
    ? ((await rootContentsRes.json()) as GhContentItem[])
    : [];
  const rootFiles = rootItems
    .filter((f) => f.type === "file")
    .map((f) => f.name);
  const rootFileSet = new Set(rootFiles);

  // Fetch a raw file from the known default branch (single attempt, no guessing)
  async function fetchRepoFile(
    path: string,
    allowSubdir = false,
  ): Promise<string | null> {
    if (!allowSubdir && !rootFileSet.has(path)) return null; // skip if not in root
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch(
        `https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}/${path}`,
        { headers: ghHeaders, signal: controller.signal },
      );
      clearTimeout(timer);
      if (!res.ok) return null;
      const blob = await res.blob();
      if (blob.size > 128 * 1024) return null;
      return blob.text();
    } catch {
      clearTimeout(timer);
      return null;
    }
  }

  // ENV_FILE candidates in priority order — pick first that exists in root
  const ENV_FILE_CANDIDATES = [
    ".env.example",
    ".env.sample",
    ".env.local.example",
    ".env",
  ];
  const envFileToFetch = ENV_FILE_CANDIDATES.find((f) => rootFileSet.has(f));

  // CONFIG files to scan for process.env.VAR patterns — only fetch ones that exist
  const CONFIG_CANDIDATES = [
    "next.config.mjs",
    "next.config.ts",
    "next.config.js",
    "vite.config.ts",
    "vite.config.js",
  ];
  const configsToFetch = CONFIG_CANDIDATES.filter((f) => rootFileSet.has(f));

  // Fetch package.json + env file + relevant config files — all in parallel
  const [pkgRaw, envRaw, ...configContents] = await Promise.all([
    fetchRepoFile("package.json"),
    envFileToFetch ? fetchRepoFile(envFileToFetch) : Promise.resolve(null),
    ...configsToFetch.map((f) => fetchRepoFile(f)),
  ]);

  let pkgJson: Record<string, unknown> | null = null;
  if (pkgRaw) {
    try {
      pkgJson = JSON.parse(pkgRaw) as Record<string, unknown>;
    } catch {
      pkgJson = null;
    }
  }

  // Parse env keys from .env-style file (skip comments and blank lines)
  const envFileKeys = envRaw
    ? envRaw
        .split("\n")
        .slice(0, 200)
        .map((l) => l.replace(/#.*$/, "").split("=")[0].trim())
        .filter((k) => /^[A-Z_][A-Z0-9_]{0,63}$/.test(k))
    : [];

  // Extract env var names from config files via regex
  const SOURCE_ENV_RE =
    /(?:process\.env|import\.meta\.env)\.([A-Z_][A-Z0-9_]{0,63})/g;
  const sourceEnvKeys = new Set<string>();
  for (const content of configContents) {
    if (!content) continue;
    const re = new RegExp(SOURCE_ENV_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      sourceEnvKeys.add(m[1]);
    }
  }

  const envKeys = [...new Set([...envFileKeys, ...sourceEnvKeys])];

  // Collect all declared package names (cap at 500 to prevent DoS)
  let deps = Object.keys({
    ...((pkgJson?.dependencies as Record<string, unknown>) ?? {}),
    ...((pkgJson?.devDependencies as Record<string, unknown>) ?? {}),
  }).slice(0, 500);

  // Monorepo support: if root package.json has no direct deps (workspace root),
  // try fetching package.json from common workspace paths to find the actual app deps.
  const isMonorepoRoot = pkgJson?.workspaces != null || deps.length === 0;
  if (isMonorepoRoot) {
    const WORKSPACE_PKG_CANDIDATES = [
      "apps/web/package.json",
      "apps/app/package.json",
      "frontend/package.json",
      "web/package.json",
      "client/package.json",
    ];
    const workspacePkgRaws = await Promise.all(
      WORKSPACE_PKG_CANDIDATES.map((p) => fetchRepoFile(p, true)),
    );
    for (const raw of workspacePkgRaws) {
      if (!raw) continue;
      try {
        const pkg = JSON.parse(raw) as Record<string, unknown>;
        const extra = Object.keys({
          ...((pkg.dependencies as Record<string, unknown>) ?? {}),
          ...((pkg.devDependencies as Record<string, unknown>) ?? {}),
        });
        deps.push(...extra);
      } catch {
        /* ignore malformed workspace package.json */
      }
    }
    if (deps.length > 500) deps.splice(500);
  }

  const repoFullName = `${owner}/${repo}`;
  const { services, connections } = detectServicesFromDeps(
    deps,
    envKeys,
    rootFiles,
  );

  const SERVICE_META: Record<
    RepoSvcType,
    { display_name: string; existing_repo?: string }
  > = {
    github: {
      display_name: "GitHub",
      existing_repo: `https://github.com/${repoFullName}`,
    },
    vercel: {
      display_name: "Vercel",
      existing_repo: `https://github.com/${repoFullName}`,
    },
    supabase: { display_name: "Supabase" },
    resend: { display_name: "Resend" },
  };

  const projectName = sanitizeProjectName(
    pkgJson?.name as string | undefined,
    repo,
  );

  return c.json({
    proposal: {
      name: projectName,
      summary: `Detected from ${repoFullName}: ${services.join(", ")}`,
      services: services.map((s) => ({
        service_type: s,
        display_name: SERVICE_META[s].display_name,
        existing_repo: SERVICE_META[s].existing_repo ?? null,
      })),
      connections,
    },
    detected_env_vars: envKeys,
    repoFullName,
  });
});

// POST /api/workflows/diagnose — AI-powered provision error diagnosis
workflowProvision.post("/diagnose", async (c) => {
  const userId = c.get("userId");
  const raw = await c.req.json<{
    error: string;
    services: string[];
    stackName: string;
  }>();

  if (!raw.error) return c.json({ error: "error required" }, 400);

  // Atomically reserve a message slot before calling AI
  const quota = await provisioningHooks.quota.reserve(userId, c.env);
  if (!quota.allowed) {
    return c.json({
      suggestion:
        "AI diagnosis is temporarily unavailable. Please try again later.",
    });
  }

  // Sanitize user inputs before embedding in LLM prompt
  const sanitize = (s: string, maxLen: number) =>
    (s ?? "").replace(/[\r\n]/g, " ").slice(0, maxLen);
  const error = sanitize(raw.error, 500);
  const stackName = sanitize(raw.stackName, 100);
  const services = (raw.services ?? [])
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.replace(/[\r\n]/g, " ").slice(0, 32))
    .filter((s) => /^[a-z0-9_\-\s]+$/i.test(s))
    .slice(0, 10);

  // Short-circuit for known errors — faster and more accurate than the AI.
  // This one in particular must NOT be paraphrased by the LLM below: the AI tends to
  // collapse it back to the generic "go install the app" advice, which is exactly the
  // wrong fix for a collaborator on a personal-account repo (see assertVercelGitHubLinked
  // in connectors/vercel.ts — collaborators can never fix this via reconnect/install).
  if (/owned by a personal GitHub account/i.test(error)) {
    return c.json({ suggestion: raw.error.slice(0, 800) });
  }

  if (/install.*github.*integration|github.*integration.*first/i.test(error)) {
    return c.json({
      suggestion:
        "Vercel can't access the repository. The Vercel GitHub App is likely set to 'Selected repositories' — go to github.com/settings/installations, find the Vercel app, click Configure, and change Repository access to 'All repositories'. Then redeploy.",
    });
  }

  const serviceList = services?.length ? services.join(", ") : "cloud services";
  const prompt = `A developer got this error while provisioning "${stackName}" (${serviceList}):\n\n"${error}"\n\nIn 2-3 sentences, identify the most likely cause and give one specific fix step. Be concrete — mention the exact service, setting, or page to check. No bullet points.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content:
            "You are a cloud infrastructure expert. Give brief, direct, actionable diagnosis of deployment errors. Always reference the specific service and a concrete fix.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) return c.json({ error: "AI unavailable" }, 502);

  const data = await res.json<{
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  }>();
  const suggestion = data.choices[0]?.message?.content?.trim() ?? "";

  // Record actual token counts (fire-and-forget — slot already reserved)
  const inputTokens = data.usage?.prompt_tokens ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;
  if (inputTokens > 0 || outputTokens > 0) {
    c.executionCtx.waitUntil(
      provisioningHooks.quota.recordTokens(
        userId,
        "gpt-4o-mini",
        inputTokens,
        outputTokens,
        c.env,
        quota.reservationId,
      ),
    );
  }

  return c.json({ suggestion });
});

// GET /api/projects/health-overview — returns health snapshot per active project
workflowProvision.get("/health-overview", async (c) => {
  const userId = c.get("userId");
  if (!isUUID(userId)) return c.json({ error: "Unauthorized" }, 401);

  // 1. Fetch user's active project IDs (cap at 50)
  const projRes = await scopedQuery(c.env, userId, "projects", {
    query: `status=eq.active&select=id&limit=50`,
  });
  if (!projRes.ok) return c.json({});
  const projects = await projRes.json<Array<{ id: string }>>();
  if (!projects.length) return c.json({});

  // 2. For each project, fetch incidents, drifts, and last deploy in parallel
  const snapshots = await Promise.all(
    projects.map(async ({ id: pid }) => {
      const [incRes, driftRes, deployRes] = await Promise.all([
        scopedQuery(c.env, userId, "incidents", {
          query: `project_id=eq.${pid}&status=eq.open&select=severity&limit=100`,
        }),
        scopedQuery(c.env, userId, "stack_drifts", {
          query: `project_id=eq.${pid}&resolved_at=is.null&select=drift_type&limit=100`,
        }),
        // project_deployments has no user_id — pid is already scoped to this
        // user from the projects query above, so NotOwnedError here is
        // unreachable in practice; .catch(() => null) mirrors the original
        // !deployRes.ok defensive fallback instead of failing the whole batch.
        scopedByProject(c.env, userId, pid, "project_deployments", {
          query: `select=status&order=queued_at.desc&limit=1`,
        }).catch(() => null),
      ]);

      const incidents = incRes.ok
        ? await incRes.json<Array<{ severity: string }>>()
        : [];
      const drifts = driftRes.ok
        ? await driftRes.json<Array<{ drift_type: string }>>()
        : [];
      const deploys = deployRes?.ok
        ? await deployRes.json<Array<{ status: string }>>()
        : [];

      return {
        id: pid,
        data: {
          critical_incidents: incidents.filter((i) => i.severity === "5xx")
            .length,
          total_incidents: incidents.length,
          critical_drifts: drifts.filter(
            (d) => d.drift_type === "resource_missing",
          ).length,
          total_drifts: drifts.length,
          last_deploy_status: deploys[0]?.status ?? null,
        },
      };
    }),
  );

  // 3. Build and return Record<projectId, snapshot>
  const overview: Record<
    string,
    {
      critical_incidents: number;
      total_incidents: number;
      critical_drifts: number;
      total_drifts: number;
      last_deploy_status: string | null;
    }
  > = {};
  for (const { id, data } of snapshots) {
    overview[id] = data;
  }

  return c.json(overview);
});

// DELETE /:projectId/edges/env-vars
// Removes env vars from a Vercel project when a synced edge is deleted from the canvas.
// Only removes vars that match the safe UPPER_SNAKE_CASE pattern.
workflowProvision.delete("/:projectId/edges/env-vars", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  if (!isUUID(projectId)) return c.json({ error: "Invalid id" }, 400);

  const body = await c.req.json<{ envVars: string[]; vercelProjectId: string }>().catch(() => null);
  if (!body || !Array.isArray(body.envVars) || typeof body.vercelProjectId !== "string" || !body.vercelProjectId) {
    return c.json({ error: "envVars and vercelProjectId required" }, 400);
  }

  // Ownership check
  const ownerRes = await scopedQuery(c.env, userId, "projects", {
    query: `id=eq.${projectId}&select=id&limit=1`,
  });
  if (!ownerRes.ok) return c.json({ error: "Failed to verify ownership" }, 500);
  const ownerRows = (await ownerRes.json()) as Array<{ id: string }>;
  if (!ownerRows.length) return c.json({ error: "Not found" }, 404);

  // Verify the client-supplied vercelProjectId actually belongs to this project's canvas
  const { canvas } = await loadCanvasWithVersion(c.env, projectId);
  const vercelNodeIds = (
    (canvas.nodes as Array<{ data?: Record<string, unknown> }> | undefined) ?? []
  )
    .filter((n) => n.data?.provider === "vercel")
    .map((n) => n.data?.vercelProjectId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  if (vercelNodeIds.length === 0) {
    return c.json({ error: "No Vercel project found on this canvas" }, 400);
  }
  if (!vercelNodeIds.includes(body.vercelProjectId)) {
    return c.json({ error: "vercelProjectId does not match any Vercel node on this project" }, 400);
  }

  // Only allow UPPER_SNAKE_CASE keys — same pattern as MCP validation
  const ENV_VAR_RE = /^[A-Z_][A-Z0-9_]{0,127}$/;
  const validKeys = body.envVars.filter((k) => typeof k === "string" && ENV_VAR_RE.test(k));
  if (!validKeys.length) return c.json({ ok: true });

  try {
    const token = await getUserToken(c.env, userId, "vercel");
    await Promise.allSettled(
      validKeys.map((key) => deleteVercelEnvVar(token, body.vercelProjectId, key)),
    );
    auditLog(c.env, userId, "edge_env_vars_removed", {
      projectId,
      vercelProjectId: body.vercelProjectId,
      keys: validKeys,
    });
    return c.json({ ok: true });
  } catch {
    return c.json({ error: "Failed to remove env vars from Vercel" }, 500);
  }
});
