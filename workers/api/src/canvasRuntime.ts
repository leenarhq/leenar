/** Runtime / derived node-data fields. These are OWNED by the backend
 *  (provisioner DO writes them to `project_env_node_state`) or by client
 *  monitoring hooks (drift / incident / usage). They are NEVER authoring intent,
 *  so they must not be persisted into the canvas JSON. This is the backend's
 *  single source of truth for that key set — kept in sync with the frontend's
 *  RUNTIME_KEYS in apps/web/src/components/canvas/hooks/useWorkflowPersistence.ts:67. */
export const RUNTIME_NODE_KEYS = new Set([
  "status",
  "provisionedAt",
  "stackId",
  "errorMsg",
  "desiredEnvKeys",
  "provisionedUrl",
  "vercelProjectId",
  "supabaseProjectRef",
  "githubRepoName",
  "githubRepoUrl",
  "cfWorkerNameProvisioned",
  "cfBucketNameProvisioned",
  "cloudflareWorkerUrl",
  "cloudflareAccountId",
  "r2Endpoint",
  "driftCount",
  "incidentCount",
  "incidents",
  "usage",
  // Native-branching per-env runtime overlay (owned by the provisioner DO,
  // written to project_env_node_state). Kept out of the authoring canvas JSON.
  "branchMode",
  "branchKey",
  "githubBranch",
  "vercelBranchAlias",
  "supabaseCloneRef",
]);

/** Runtime / derived edge-data fields. Set by client deploy hooks
 *  (`useDeployFlow.ts`) once both endpoint nodes are provisioned — these
 *  mark an edge as "synced" (drawn green in BlueprintEdge.tsx) and are NEVER
 *  authoring intent. They must not be persisted when a canvas is copied into
 *  a fresh environment (create / branch), since the new environment's nodes
 *  start unprovisioned and a "synced" edge would be misleading. */
export const RUNTIME_EDGE_KEYS = new Set(["synced"]);

/** Given a canvas object (`{ nodes, edges, viewport? }`), return a new canvas
 *  object with every key in RUNTIME_NODE_KEYS deleted from every node's `data`.
 *  Edge data (including the `synced` flag / `markerEnd`) is left untouched —
 *  this function is used on every normal canvas save (autosave PUT, PATCH),
 *  and legitimately-synced edges must round-trip across those saves.
 *  Defense-in-depth: applied server-side at canvas-write endpoints so a buggy
 *  or malicious client cannot smuggle spoofed runtime status into persisted
 *  canvas JSON, even though the frontend already strips these before autosave.
 *  For the "seed a fresh/copied environment" case (env create / branch), use
 *  `stripRuntimeFromCanvasForNewEnvironment` instead — see below. */
export function stripRuntimeFromCanvas(canvas: unknown): unknown {
  if (!canvas || typeof canvas !== "object") return canvas;
  const c = canvas as {
    nodes?: unknown[];
    edges?: unknown[];
    viewport?: unknown;
  };
  return {
    ...c,
    nodes: (c.nodes ?? []).map((n: any) => {
      const data = { ...n.data };
      for (const key of RUNTIME_NODE_KEYS) delete data[key];
      return { ...n, data };
    }),
    edges: (c.edges ?? []).map((e: any) => ({ ...e, data: { ...e.data } })),
  };
}

/** Same as `stripRuntimeFromCanvas`, but ALSO strips RUNTIME_EDGE_KEYS
 *  (`data.synced`) and the top-level `markerEnd` prop from every edge.
 *
 *  Use this ONLY when seeding a brand-new/copied environment (env create,
 *  env branch) — never on a normal canvas save. When a canvas is copied into
 *  a fresh environment, the new environment's nodes start unprovisioned, so
 *  an inherited "synced" edge (drawn green in BlueprintEdge.tsx) would be
 *  misleading. Normal saves (PUT/PATCH canvas) must NOT strip this, since
 *  edges legitimately marked synced by `useDeployFlow.ts` after a real
 *  deploy need to persist across autosave. */
export function stripRuntimeFromCanvasForNewEnvironment(
  canvas: unknown,
): unknown {
  const stripped = stripRuntimeFromCanvas(canvas);
  if (!stripped || typeof stripped !== "object") return stripped;
  const c = stripped as { edges?: unknown[] };
  return {
    ...c,
    edges: (c.edges ?? []).map((e: any) => {
      const data = { ...e.data };
      for (const key of RUNTIME_EDGE_KEYS) delete data[key];
      // `markerEnd` is a top-level (non-`data`) ReactFlow edge prop that
      // useDeployFlow.ts sets to a green arrowhead in lockstep with
      // `data.synced` — strip it too so a fresh environment doesn't inherit
      // a "synced" arrowhead on an edge whose nodes are unprovisioned.
      const { markerEnd, ...rest } = e;
      return { ...rest, data };
    }),
  };
}
