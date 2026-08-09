/**
 * Pure helper extracted from normalizeEnvInjection (workflowProvision.ts).
 * Computes which env var keys should be present on a specific canvas node,
 * based on the canvas edge topology and ENV_FLOW rules.
 *
 * Priority: edge.data.envVars (user override) > ENV_FLOW forward/reverse lookup.
 *
 * Called at provision time (to persist desiredEnvKeys to node state) and at
 * drift-check time (as fallback when state.desiredEnvKeys is absent).
 */
import { ENV_FLOW, WRITE_ONCE_ENV_KEYS, resolveEnvKeys } from "./constants/envFlow";

export function inferServiceKey(data: Record<string, unknown>): string | null {
  const p = (data.provider as string | undefined)?.toLowerCase();
  if (!p) return null;
  if (p === "cloudflare") {
    return (data.cloudflareService as string) === "r2"
      ? "cloudflare-r2"
      : "cloudflare-workers";
  }
  return p;
}

const isProvisioned = (data: Record<string, unknown>): boolean =>
  (data.status as string | undefined) === "provisioned";

/**
 * Env keys that buildPreloadedCtx emits with a node-scoped `${KEY}_${sourceId}`
 * twin, mapped to the service of the node that provides the value. The global
 * (un-suffixed) key is last-writer-wins across all provider nodes of that type,
 * so a multi-node canvas cross-wires (e.g. two GitHub repos → two Vercels would
 * both get the last repo's owner). scopedCtxOverrides resolves the value from
 * the source node actually wired to the step. Mirrors the Supabase
 * `supabase_url_${nodeId}` handling in provisioner.do.ts::executeStep.
 */
const SCOPED_CTX_KEY_SERVICE: Record<string, string> = {
  GITHUB_OWNER: "github",
  GITHUB_REPO: "github",
  GITHUB_REPO_URL: "github",
  API_URL: "cloudflare-workers",
  WORKER_URL: "cloudflare-workers",
  NEXT_PUBLIC_API_URL: "cloudflare-workers",
  NEXT_PUBLIC_WORKER_URL: "cloudflare-workers",
  ALLOWED_ORIGIN: "vercel",
  FRONTEND_URL: "vercel",
};

/**
 * For a provisioning step, resolve the node-scoped ctx value for each injected
 * key from the source node wired to `stepNodeId`, preferring it over the global
 * last-writer-wins value. Returns only the keys that have a non-empty scoped
 * value; callers merge the result over the base injected env.
 */
export function scopedCtxOverrides(
  stepNodeId: string | undefined,
  canvas:
    | {
        nodes: Array<{ id: string; data: Record<string, unknown> }>;
        edges: Array<{ source: string; target: string }>;
      }
    | undefined,
  ctx: Record<string, string>,
  keys: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!canvas || !stepNodeId) return out;

  const wiredSourceId = (svc: string): string | undefined => {
    for (const e of canvas.edges) {
      const other =
        e.source === stepNodeId
          ? e.target
          : e.target === stepNodeId
            ? e.source
            : null;
      if (!other) continue;
      const n = canvas.nodes.find((x) => x.id === other);
      if (n && inferServiceKey(n.data) === svc) return other;
    }
    return undefined;
  };

  const srcCache = new Map<string, string | undefined>();
  for (const key of keys) {
    const svc = SCOPED_CTX_KEY_SERVICE[key];
    if (!svc) continue;
    if (!srcCache.has(svc)) srcCache.set(svc, wiredSourceId(svc));
    const srcId = srcCache.get(svc);
    if (!srcId) continue;
    const scoped = ctx[`${key}_${srcId}`];
    if (scoped != null && scoped !== "") out[key] = scoped;
  }
  return out;
}

export function computeDesiredEnvKeys(
  canvas: {
    nodes: Array<{ id: string; data: Record<string, unknown> }>;
    edges: Array<{ source: string; target: string; data?: { envVars?: string[] } }>;
  },
  nodeId: string,
  opts?: { requireProvisionedSource?: boolean },
): string[] {
  // When true, only count env keys whose value-providing node is actually
  // provisioned. Edge-gated injection means an un-provisioned source never had
  // its vars injected into the target, so those keys are not really "expected"
  // in the cloud — counting them produces false `env_removed` drifts.
  const requireProvisionedSource = opts?.requireProvisionedSource === true;
  const keys = new Set<string>();
  const node = canvas.nodes.find((n) => n.id === nodeId);
  if (!node) return [];
  const nodeSvc = inferServiceKey(node.data);
  if (!nodeSvc) return [];
  const nodeFramework = node.data.framework as string | undefined;

  for (const edge of canvas.edges) {
    if (edge.target === nodeId) {
      // Forward flow: srcNode → nodeId. The value provider is srcNode.
      const srcNode = canvas.nodes.find((n) => n.id === edge.source);
      if (!srcNode) {
        // Orphan edge: source node no longer in canvas (removed after provisioning).
        // If the edge has explicit envVars they were intentionally wired and injected
        // before the node was removed — include them regardless of requireProvisionedSource
        // so drift detection can still track what was put into the target service.
        if (edge.data?.envVars?.length) {
          for (const k of edge.data.envVars) keys.add(k);
        }
        continue;
      }
      if (requireProvisionedSource && !isProvisioned(srcNode.data)) continue;
      // User override: edge.data.envVars takes priority
      if (edge.data?.envVars?.length) {
        for (const k of edge.data.envVars) keys.add(k);
        continue;
      }
      const srcSvc = inferServiceKey(srcNode.data);
      if (!srcSvc) continue;
      const fwdVars = ENV_FLOW[srcSvc]?.[nodeSvc] ?? []; // base names
      for (const k of resolveEnvKeys(fwdVars, nodeSvc, nodeFramework)) {
        if (!WRITE_ONCE_ENV_KEYS.has(k)) keys.add(k);
      }
    } else if (edge.source === nodeId) {
      // Edge drawn as nodeId → target.
      const tgtNode = canvas.nodes.find((n) => n.id === edge.target);
      if (!tgtNode) continue;
      const tgtSvc = inferServiceKey(tgtNode.data);
      if (!tgtSvc) continue;
      const fwdVars = ENV_FLOW[nodeSvc]?.[tgtSvc] ?? []; // no default fallback

      // User override on a nodeId → target edge. It only lands on THIS node when
      // the edge is "backwards" (no forward ENV_FLOW pair, reverse pair exists):
      // normalizeEnvInjection (workflowProvision.ts) flips it and injects into the
      // source (this node). Otherwise the override goes to the target — skip here.
      if (edge.data?.envVars?.length) {
        const revVars = ENV_FLOW[tgtSvc]?.[nodeSvc] ?? [];
        const shouldFlip = fwdVars.length === 0 && revVars.length > 0;
        if (!shouldFlip) continue; // override lands on target, not nodeId
        // After flip the target is the value provider — gate on it being provisioned.
        if (requireProvisionedSource && !isProvisioned(tgtNode.data)) continue;
        // Matches inject-time resolveEnvKeys(overrideVars, srcSvc) where srcSvc is
        // this node's service (workflowProvision.ts:269).
        for (const k of resolveEnvKeys(edge.data.envVars, nodeSvc, nodeFramework)) {
          if (!WRITE_ONCE_ENV_KEYS.has(k)) keys.add(k);
        }
        continue;
      }

      // No override. If no forward vars defined, check if this was a backwards edge
      // (after normalization it would flip → revVars inject INTO nodeId).
      // In that flipped case tgtNode is the value provider.
      if (!fwdVars.length) {
        if (requireProvisionedSource && !isProvisioned(tgtNode.data)) continue;
        // Reverse flow: after normalization this edge flips → revVars inject into nodeId
        const revVars = ENV_FLOW[tgtSvc]?.[nodeSvc] ?? []; // base names
        for (const k of resolveEnvKeys(revVars, nodeSvc, nodeFramework)) {
          if (!WRITE_ONCE_ENV_KEYS.has(k)) keys.add(k);
        }
      }
    }
  }

  // Also include env vars set directly on this node (not from edges)
  const customVars = node.data.customEnvVars as
    | Array<{ key: string }>
    | undefined;
  if (Array.isArray(customVars)) {
    for (const v of customVars) {
      if (typeof v.key === "string" && v.key) keys.add(v.key);
    }
  }

  return [...keys];
}
