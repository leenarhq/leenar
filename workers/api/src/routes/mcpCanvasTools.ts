// The canvas-authoring tool subset — the only AI tools the open-core edition
// ships.
//
// This module exists so both editions read one definition. routes/mcp.ts (the
// cloud registry) re-exports from here; routes/mcp.core.ts (staged over
// routes/mcp.ts at export) exposes only what is here. Duplicating these
// handlers into a core twin would put the product's canvas semantics in two
// places that drift silently — the same failure the Docker asset twins need a
// dedicated drift check to survive.
//
// Nothing in this file may reach an autonomy capability: no deploy, no drift
// reconcile, no incident mutation, no cost, no API-key management.
// An upstream export-time check enforces that on the published tree.
//
// Import direction is one-way: routes/mcp.ts imports from here, never the
// reverse. A back-import would break the core edition, where routes/mcp.ts IS
// routes/mcp.core.ts and holds none of these symbols.
import type { Env } from "../types";
import type { WorkingNode } from "../canvasDiff";
import { type CanvasEdge, type CanvasNode, analyzeRepo } from "./workflowProvision";
import { isUUID, auditLog, getUserToken } from "../utils";
import { scopedQuery } from "../tenancy";
import { patchCanvasWithVersion, assertCanvasUnlocked } from "../canvasVersion";
import { ENV_FLOW } from "../constants/envFlow";
import { listRepos } from "../connectors/github";
import { deleteVercelEnvVar } from "../connectors/vercel";
import { listConnections as listConnectionsRest } from "./oauth";
import { listEnvironmentsData } from "./environments";

export const PROVIDER_META: Record<
  string,
  {
    label: string;
    iconName: string;
    provider?: string;
    cloudflareService?: string;
  }
> = {
  github: { label: "GitHub", iconName: "Github" },
  vercel: { label: "Vercel", iconName: "Triangle" },
  supabase: { label: "Supabase", iconName: "Database" },
  resend: { label: "Resend", iconName: "Send" },
  "cloudflare-workers": {
    label: "Cloudflare Workers",
    iconName: "Cloudflare",
    provider: "cloudflare",
    cloudflareService: "workers",
  },
  "cloudflare-r2": {
    label: "Cloudflare R2",
    iconName: "Cloudflare",
    provider: "cloudflare",
    cloudflareService: "r2",
  },
};

/** OpenAI/MCP schemas for the 13 canvas tools. routes/mcp.ts splices these
 *  into its full TOOLS array; the core registry uses them as its whole TOOLS. */
export const CANVAS_TOOL_SCHEMAS = [
  {
    name: "list_workflows",
    description:
      "List all your Leenar workflows with their name, status, and ID.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_canvas",
    description:
      "Get the canvas (nodes and edges) for a specific workflow. Returns the full infrastructure topology.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "The workflow UUID" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "add_service",
    description:
      "Add a service node (github, vercel, supabase, resend, cloudflare-workers, cloudflare-r2) to a workflow canvas.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "The workflow UUID" },
        provider: {
          type: "string",
          enum: [
            "github",
            "vercel",
            "supabase",
            "resend",
            "cloudflare-workers",
            "cloudflare-r2",
          ],
          description: "The service provider to add",
        },
      },
      required: ["project_id", "provider"],
    },
  },
  {
    name: "connect_services",
    description:
      "Connect two service nodes on the canvas with a directed edge (source → target injects env vars).",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "The workflow UUID" },
        source_node_id: {
          type: "string",
          description: "ID of the source node",
        },
        target_node_id: {
          type: "string",
          description: "ID of the target node",
        },
      },
      required: ["project_id", "source_node_id", "target_node_id"],
    },
  },
  {
    name: "update_node",
    description:
      "Update configuration fields on a canvas node (repo URL, project name, region, email config, custom env vars, Cloudflare worker/R2 config, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "The workflow UUID" },
        node_id: { type: "string", description: "ID of the node to update" },
        confirm: {
          type: "boolean",
          description:
            "Set to true after the user has approved this action. If not provided, this call returns a confirmation_required response.",
        },
        updates: {
          type: "object",
          description: "Fields to update on node.data",
          properties: {
            existing_repo: {
              type: "string",
              description: "GitHub repo URL for Vercel node",
            },
            projectName: { type: "string", description: "Custom project name" },
            region: {
              type: "string",
              description: "Deployment region (e.g. us-east-1)",
            },
            fromEmail: {
              type: "string",
              description: "Sender email address for Resend/Supabase",
            },
            senderName: { type: "string", description: "Sender display name" },
            cfWorkerName: {
              type: "string",
              description:
                "Worker script name for Cloudflare Workers node (max 63 chars)",
            },
            compatibilityDate: {
              type: "string",
              description:
                "Compatibility date for Cloudflare Workers node (e.g. 2024-09-23)",
            },
            cfBucketName: {
              type: "string",
              description: "Bucket name for Cloudflare R2 node (max 63 chars)",
            },
            cfLocationHint: {
              type: "string",
              description:
                "Location hint for Cloudflare R2 bucket (e.g. enam, wnam, eeur, apac)",
            },
            customEnvVars: {
              type: "array",
              description: "Custom environment variables",
              items: {
                type: "object",
                properties: {
                  key: { type: "string" },
                  value: { type: "string" },
                },
                required: ["key", "value"],
              },
            },
          },
        },
      },
      required: ["project_id", "node_id", "updates"],
    },
  },
  {
    name: "remove_node",
    description:
      "Remove a service node and all its connected edges from the canvas.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "The workflow UUID" },
        node_id: { type: "string", description: "ID of the node to remove" },
        confirm: {
          type: "boolean",
          description:
            "Set to true after the user has approved this action. If not provided, this call returns a confirmation_required response.",
        },
      },
      required: ["project_id", "node_id"],
    },
  },
  {
    name: "remove_edge",
    description: "Remove the edge (connection) between two service nodes.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "The workflow UUID" },
        source_node_id: {
          type: "string",
          description: "ID of the source node",
        },
        target_node_id: {
          type: "string",
          description: "ID of the target node",
        },
        confirm: {
          type: "boolean",
          description:
            "Set to true after the user has approved this action. If not provided, this call returns a confirmation_required response.",
        },
      },
      required: ["project_id", "source_node_id", "target_node_id"],
    },
  },
  {
    name: "list_vercel_projects",
    description:
      "List Vercel projects linked to your connected Vercel account.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_github_repos",
    description:
      "List GitHub repositories accessible to your connected GitHub account.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_supabase_projects",
    description: "List Supabase projects in your connected Supabase account.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_workflow_env_vars",
    description:
      "Get all environment variable names wired on canvas edges for a workflow. " +
      "Use this in Scenario 3 (infra already designed, writing code to match): read the canvas topology, " +
      "then use the returned env var names to populate process.env / import.meta.env references in your code. " +
      "Returns a per-edge breakdown (source/target providers + var names) and a deduplicated all_env_vars list.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "The workflow UUID" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "list_connections",
    description:
      "List your connected third-party integrations (GitHub, Vercel, Supabase, Resend, Cloudflare). " +
      "Returns service name and connection timestamps — never returns tokens.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_environments",
    description:
      "List the per-project environments (e.g. dev/staging/prod) for a workflow, including which one is " +
      "the default and their display order.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "The workflow UUID" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "import_from_builder",
    description:
      "Analyse a GitHub repository built by an AI app builder (Lovable, and others as they are added). " +
      "Reports which Supabase project the app already talks to, whether that project belongs to the " +
      "user, and which services Leenar would put on the canvas. Read-only: it inspects the repo and " +
      "does not change anything.",
    inputSchema: {
      type: "object",
      properties: {
        repo_url: {
          type: "string",
          description: "GitHub repository URL, e.g. https://github.com/acme/app",
        },
      },
      required: ["repo_url"],
    },
  },
];

// Tools the web canvas-editing agent (mode:"canvas") may call: read tools +
// canvas authoring. Infra-ops/deploy tools are intentionally excluded — the
// canvas chat only builds/wires the canvas; deploy stays a button.
// set_edge_env_vars and import_node are excluded: per-edge env-var edits aren't
// representable in CanvasUpdatePayload, and import_node is out of first-cut scope.
export const CANVAS_ALLOWED_TOOLS = new Set([
  // read
  "get_canvas",
  "list_workflows",
  "list_environments",
  "list_connections",
  "get_workflow_env_vars",
  "list_vercel_projects",
  "list_github_repos",
  "list_supabase_projects",
  "import_from_builder",
  // canvas authoring (dual-mode: mutate env._workingCanvas when present)
  "add_service",
  "connect_services",
  "update_node",
  "remove_node",
  "remove_edge",
]);

/**
 * Chat/channel callers name a workflow ("qrucial"), but every project-scoped
 * tool needs its UUID. Models call list_workflows unreliably, so we resolve
 * here in code: when project_id is present but not a UUID, treat it as a name
 * and look up the caller's matching project (case-insensitive). Returns the id,
 * or an Error whose message lists the real workflow names so the agent can
 * relay a useful reply. A value that is already a UUID passes through untouched,
 * so canvas mode and external MCP callers (who always send UUIDs) are unaffected.
 */
export async function resolveProjectIdByName(
  raw: string,
  userId: string,
  env: Env,
): Promise<string> {
  const res = await scopedQuery(env, userId, "projects", {
    query: `select=id,name`,
  });
  if (!res.ok) throw new Error("Failed to look up workflow by name");
  const rows = (await res.json()) as Array<{ id: string; name: string }>;
  const wanted = raw.trim().toLowerCase();
  const match = rows.find((r) => (r.name ?? "").trim().toLowerCase() === wanted);
  if (match) return match.id;
  const names = rows.map((r) => r.name).filter(Boolean);
  throw new Error(
    names.length
      ? `No workflow named "${raw}". Your workflows are: ${names.join(", ")}.`
      : `No workflow named "${raw}", and you have no workflows yet.`,
  );
}

export async function listWorkflows(userId: string, env: Env) {
  const res = await scopedQuery(env, userId, "projects", {
    query: `order=created_at.desc&select=id,name,status,created_at,updated_at`,
  });
  if (!res.ok) throw new Error("Failed to fetch workflows");
  const rows = (await res.json()) as unknown[];
  return { workflows: rows };
}

/** Redacts customEnvVars[].value on every node so MCP callers (including
 *  read-only API keys) can't read plaintext secrets via canvas topology.
 *  Returns a new object; never mutates the input (DB row stays untouched). */
function maskCanvasEnvValues(canvas: {
  nodes?: CanvasNode[];
  [key: string]: unknown;
}): typeof canvas {
  if (!canvas?.nodes) return canvas;
  return {
    ...canvas,
    nodes: canvas.nodes.map((node) => {
      const customEnvVars = (node.data as Record<string, unknown> | undefined)
        ?.customEnvVars;
      if (!Array.isArray(customEnvVars)) return node;
      return {
        ...node,
        data: {
          ...node.data,
          customEnvVars: customEnvVars.map((item) =>
            item && typeof item === "object"
              ? { ...item, value: "[REDACTED]" }
              : item,
          ),
        },
      };
    }),
  };
}

export async function getCanvas(projectId: string, userId: string, env: Env) {
  if (env._workingCanvas) {
    return { canvas: env._workingCanvas };
  }
  if (!isUUID(projectId)) throw new Error("Invalid project_id");
  const res = await scopedQuery(env, userId, "projects", {
    query: `id=eq.${projectId}&select=id,name,canvas,status&limit=1`,
  });
  if (!res.ok) throw new Error("Failed to fetch workflow");
  const rows = (await res.json()) as Array<
    { canvas: { nodes?: CanvasNode[]; [key: string]: unknown } } & Record<
      string,
      unknown
    >
  >;
  if (!rows.length) throw new Error("Workflow not found");
  const row = rows[0];
  return { ...row, canvas: maskCanvasEnvValues(row.canvas) };
}

// Resolve the ENV_FLOW dispatch key for a node. "cloudflare" provider nodes map to
// "cloudflare-workers"/"cloudflare-r2" (the canonical ENV_FLOW keys); all other
// providers use their provider string verbatim. Used both when creating edges and
// when reconstructing env-var values so the two stay consistent.
function envFlowKey(node: CanvasNode | undefined): string {
  const data = (node?.data ?? {}) as Record<string, unknown>;
  const p = (data.provider as string | undefined)?.toLowerCase() ?? "";
  if (p === "cloudflare") {
    const sub = (data.cloudflareService as string | undefined)?.toLowerCase();
    return sub === "r2" ? "cloudflare-r2" : "cloudflare-workers";
  }
  return p;
}

// Shared service-node construction, used by both the DB path and the in-memory
// working-canvas path so the two can never drift. Throws on an unknown provider.
function buildServiceNode(
  provider: string,
  existingCount: number,
): { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> } {
  const meta = PROVIDER_META[provider];
  if (!meta)
    throw new Error(
      `Unknown provider "${provider}". Valid: github, vercel, supabase, resend, cloudflare-workers, cloudflare-r2`,
    );
  const nodeData: Record<string, unknown> = {
    label: meta.label,
    iconName: meta.iconName,
    provider: meta.provider ?? provider,
    incidents: [],
    incidentCount: 0,
  };
  if (meta.cloudflareService) nodeData.cloudflareService = meta.cloudflareService;
  return {
    id: `service-${Date.now()}-${existingCount}`,
    type: "service",
    position: { x: existingCount * 160, y: 100 },
    data: nodeData,
  };
}

export async function addService(
  projectId: string,
  provider: string,
  userId: string,
  env: Env,
) {
  if (env._workingCanvas) {
    const wc = env._workingCanvas;
    const newNode = buildServiceNode(provider, wc.nodes.length);
    wc.nodes.push(newNode as unknown as WorkingNode); // mutate the shared object
    return { ok: true, node_id: newNode.id, provider, label: newNode.data.label as string };
  }
  if (!isUUID(projectId)) throw new Error("Invalid project_id");
  const meta = PROVIDER_META[provider];
  if (!meta)
    throw new Error(
      `Unknown provider "${provider}". Valid: github, vercel, supabase, resend, cloudflare-workers, cloudflare-r2`,
    );

  await assertCanvasUnlocked(env, projectId, userId);

  const wfRes = await scopedQuery(env, userId, "projects", {
    query: `id=eq.${projectId}&select=canvas,canvas_version&limit=1`,
  });
  if (!wfRes.ok) throw new Error("Failed to fetch workflow");
  const rows = (await wfRes.json()) as Array<{
    canvas: { nodes: CanvasNode[]; edges: CanvasEdge[] };
    canvas_version: number;
  }>;
  if (!rows.length) throw new Error("Workflow not found");

  const canvas = rows[0].canvas;
  const canvasVersion = rows[0].canvas_version;
  const nodes: CanvasNode[] = canvas.nodes ?? [];
  const newNode = buildServiceNode(provider, nodes.length);

  const updatedCanvas = {
    ...canvas,
    nodes: [...nodes, newNode as unknown as CanvasNode],
  };
  const addResult = await patchCanvasWithVersion(
    env,
    projectId,
    canvasVersion,
    () => updatedCanvas as unknown as Record<string, unknown>,
    userId,
  );
  if (!addResult.ok && addResult.conflict) {
    throw new Error(
      "canvas_conflict — canvas was modified concurrently. Re-fetch and retry.",
    );
  }
  if (!addResult.ok) throw new Error("Failed to update canvas");

  return { ok: true, node_id: newNode.id, provider, label: newNode.data.label as string };
}

export async function connectServices(
  projectId: string,
  sourceNodeId: string,
  targetNodeId: string,
  userId: string,
  env: Env,
) {
  if (env._workingCanvas) {
    const wc = env._workingCanvas;
    if (!sourceNodeId || !targetNodeId)
      throw new Error("source_node_id and target_node_id are required");
    const srcNode = wc.nodes.find((n) => n.id === sourceNodeId);
    const tgtNode = wc.nodes.find((n) => n.id === targetNodeId);
    if (!srcNode) throw new Error(`Source node "${sourceNodeId}" not found`);
    if (!tgtNode) throw new Error(`Target node "${targetNodeId}" not found`);
    const srcKey = envFlowKey(srcNode as unknown as CanvasNode);
    const tgtKey = envFlowKey(tgtNode as unknown as CanvasNode);
    const forwardVars = srcKey && tgtKey ? (ENV_FLOW[srcKey]?.[tgtKey] ?? []) : [];
    const reverseVars = srcKey && tgtKey ? (ENV_FLOW[tgtKey]?.[srcKey] ?? []) : [];
    const shouldFlip = forwardVars.length === 0 && reverseVars.length > 0;
    const from = shouldFlip ? targetNodeId : sourceNodeId;
    const to = shouldFlip ? sourceNodeId : targetNodeId;
    if (wc.edges.find((e) => e.source === from && e.target === to))
      throw new Error("Edge already exists between these nodes");
    const edgeId = `edge-${Date.now()}-${wc.edges.length}`;
    wc.edges.push({ id: edgeId, source: from, target: to });
    return { ok: true, edge_id: edgeId, source: sourceNodeId, target: targetNodeId };
  }
  if (!isUUID(projectId)) throw new Error("Invalid project_id");
  if (!sourceNodeId || !targetNodeId)
    throw new Error("source_node_id and target_node_id are required");

  await assertCanvasUnlocked(env, projectId, userId);

  const wfRes = await scopedQuery(env, userId, "projects", {
    query: `id=eq.${projectId}&select=canvas,canvas_version&limit=1`,
  });
  if (!wfRes.ok) throw new Error("Failed to fetch workflow");
  const rows = (await wfRes.json()) as Array<{
    canvas: { nodes: CanvasNode[]; edges: CanvasEdge[] };
    canvas_version: number;
  }>;
  if (!rows.length) throw new Error("Workflow not found");

  const canvas = rows[0].canvas;
  const canvasVersion = rows[0].canvas_version;
  const nodes: CanvasNode[] = canvas.nodes ?? [];
  const edges: CanvasEdge[] = canvas.edges ?? [];

  if (!nodes.find((n) => n.id === sourceNodeId))
    throw new Error(`Source node "${sourceNodeId}" not found`);
  if (!nodes.find((n) => n.id === targetNodeId))
    throw new Error(`Target node "${targetNodeId}" not found`);
  if (
    edges.find((e) => e.source === sourceNodeId && e.target === targetNodeId)
  ) {
    throw new Error("Edge already exists between these nodes");
  }

  // Resolve the ENV_FLOW key for a node — "cloudflare" nodes need cloudflareService
  const resolveServiceKey = (node: CanvasNode): string => envFlowKey(node);

  // Compute env vars to inject based on ENV_FLOW so deploy can sync them
  const srcNode = nodes.find((n) => n.id === sourceNodeId)!;
  const tgtNode = nodes.find((n) => n.id === targetNodeId)!;
  const srcKey = resolveServiceKey(srcNode);
  const tgtKey = resolveServiceKey(tgtNode);
  const forwardVars = srcKey && tgtKey ? (ENV_FLOW[srcKey]?.[tgtKey] ?? []) : [];
  const reverseVars = srcKey && tgtKey ? (ENV_FLOW[tgtKey]?.[srcKey] ?? []) : [];
  // If only the reverse ENV_FLOW direction matches, the edge was drawn "backwards"
  // relative to the dependency (e.g. Vercel→Supabase when only Supabase→Vercel is
  // defined). Flip source/target so the stored edge stays consistent with the
  // forward direction that resolveEnvMapFromCanvas expects —
  // mirrors the flip normalizeEnvInjection performs at deploy time.
  const shouldFlip = forwardVars.length === 0 && reverseVars.length > 0;
  const computedEnvVars = forwardVars.length > 0 ? forwardVars : reverseVars;
  const edgeSource = shouldFlip ? targetNodeId : sourceNodeId;
  const edgeTarget = shouldFlip ? sourceNodeId : targetNodeId;

  const edgeId = `edge-${Date.now()}`;
  const newEdge = {
    id: edgeId,
    source: edgeSource,
    target: edgeTarget,
    type: "blueprint",
    animated: false,
    selected: false,
    markerEnd: { type: "arrowclosed", color: "#34d399" },
    data: { synced: false, envVars: computedEnvVars },
  };

  const updatedCanvas = { ...canvas, edges: [...edges, newEdge] };
  const connResult = await patchCanvasWithVersion(
    env,
    projectId,
    canvasVersion,
    () => updatedCanvas as unknown as Record<string, unknown>,
    userId,
  );
  if (!connResult.ok && connResult.conflict) {
    throw new Error(
      "canvas_conflict — canvas was modified concurrently. Re-fetch and retry.",
    );
  }
  if (!connResult.ok) throw new Error("Failed to update canvas");

  return {
    ok: true,
    edge_id: edgeId,
    source: sourceNodeId,
    target: targetNodeId,
  };
}

export async function listConnectionsTool(userId: string, env: Env) {
  const connections = await listConnectionsRest(userId, env);
  return { connections };
}

export async function updateNode(
  projectId: string,
  nodeId: string,
  updates: Record<string, unknown>,
  userId: string,
  env: Env,
) {
  if (env._workingCanvas) {
    if (!nodeId) throw new Error("node_id is required");
    const wc = env._workingCanvas;
    const node = wc.nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`Node "${nodeId}" not found`);
    const allowedFields = [
      "existing_repo", "projectName", "region", "fromEmail", "senderName",
      "cfWorkerName", "compatibilityDate", "cfBucketName", "cfLocationHint", "customEnvVars",
    ];
    const safeUpdates: Record<string, unknown> = {};
    for (const key of allowedFields) if (key in updates) safeUpdates[key] = updates[key];
    node.data = { ...node.data, ...safeUpdates };
    return { ok: true, node_id: nodeId, updated_fields: Object.keys(safeUpdates) };
  }
  if (!isUUID(projectId)) throw new Error("Invalid project_id");
  if (!nodeId) throw new Error("node_id is required");

  await assertCanvasUnlocked(env, projectId, userId);

  const wfRes = await scopedQuery(env, userId, "projects", {
    query: `id=eq.${projectId}&select=canvas,canvas_version&limit=1`,
  });
  if (!wfRes.ok) throw new Error("Failed to fetch workflow");
  const rows = (await wfRes.json()) as Array<{
    canvas: { nodes: CanvasNode[]; edges: CanvasEdge[] };
    canvas_version: number;
  }>;
  if (!rows.length) throw new Error("Workflow not found");

  const canvas = rows[0].canvas;
  const canvasVersion = rows[0].canvas_version;
  const nodes: CanvasNode[] = canvas.nodes ?? [];
  const nodeIndex = nodes.findIndex((n) => n.id === nodeId);
  if (nodeIndex === -1) throw new Error(`Node "${nodeId}" not found`);

  const allowedFields = [
    "existing_repo",
    "projectName",
    "region",
    "fromEmail",
    "senderName",
    "cfWorkerName",
    "compatibilityDate",
    "cfBucketName",
    "cfLocationHint",
    "customEnvVars",
  ];
  const safeUpdates: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in updates) safeUpdates[key] = updates[key];
  }

  nodes[nodeIndex] = {
    ...nodes[nodeIndex],
    data: { ...nodes[nodeIndex].data, ...safeUpdates },
  };
  const updatedCanvas = { ...canvas, nodes };
  const updateResult = await patchCanvasWithVersion(
    env,
    projectId,
    canvasVersion,
    () => updatedCanvas as unknown as Record<string, unknown>,
    userId,
  );
  if (!updateResult.ok && updateResult.conflict) {
    throw new Error(
      "canvas_conflict — canvas was modified concurrently. Re-fetch and retry.",
    );
  }
  if (!updateResult.ok) throw new Error("Failed to update node");

  auditLog(env, userId, "node_updated", {
    projectId,
    nodeId,
    fields: Object.keys(safeUpdates),
    source: "mcp",
  });
  return {
    ok: true,
    node_id: nodeId,
    updated_fields: Object.keys(safeUpdates),
  };
}

export async function removeNode(
  projectId: string,
  nodeId: string,
  userId: string,
  env: Env,
) {
  if (env._workingCanvas) {
    if (!nodeId) throw new Error("node_id is required");
    const wc = env._workingCanvas;
    if (!wc.nodes.find((n) => n.id === nodeId)) throw new Error(`Node "${nodeId}" not found`);
    const before = wc.edges.length;
    wc.nodes = wc.nodes.filter((n) => n.id !== nodeId);
    wc.edges = wc.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
    return { ok: true, node_id: nodeId, removed_edges: before - wc.edges.length };
  }
  if (!isUUID(projectId)) throw new Error("Invalid project_id");
  if (!nodeId) throw new Error("node_id is required");

  await assertCanvasUnlocked(env, projectId, userId);

  const wfRes = await scopedQuery(env, userId, "projects", {
    query: `id=eq.${projectId}&select=canvas,canvas_version&limit=1`,
  });
  if (!wfRes.ok) throw new Error("Failed to fetch workflow");
  const rows = (await wfRes.json()) as Array<{
    canvas: { nodes: CanvasNode[]; edges: CanvasEdge[] };
    canvas_version: number;
  }>;
  if (!rows.length) throw new Error("Workflow not found");

  const canvas = rows[0].canvas;
  const canvasVersion = rows[0].canvas_version;
  const nodes: CanvasNode[] = canvas.nodes ?? [];
  if (!nodes.find((n) => n.id === nodeId))
    throw new Error(`Node "${nodeId}" not found`);

  const updatedNodes = nodes.filter((n) => n.id !== nodeId);
  const edges: CanvasEdge[] = canvas.edges ?? [];
  const updatedEdges = edges.filter(
    (e) => e.source !== nodeId && e.target !== nodeId,
  );

  const updatedCanvas = { ...canvas, nodes: updatedNodes, edges: updatedEdges };
  const removeResult = await patchCanvasWithVersion(
    env,
    projectId,
    canvasVersion,
    () => updatedCanvas as unknown as Record<string, unknown>,
    userId,
  );
  if (!removeResult.ok && removeResult.conflict) {
    throw new Error(
      "canvas_conflict — canvas was modified concurrently. Re-fetch and retry.",
    );
  }
  if (!removeResult.ok) throw new Error("Failed to remove node");

  auditLog(env, userId, "node_removed", {
    projectId,
    nodeId,
    removedEdges: edges.length - updatedEdges.length,
    source: "mcp",
  });
  return {
    ok: true,
    node_id: nodeId,
    removed_edges: edges.length - updatedEdges.length,
  };
}

export async function removeEdge(
  projectId: string,
  sourceNodeId: string,
  targetNodeId: string,
  userId: string,
  env: Env,
) {
  if (env._workingCanvas) {
    if (!sourceNodeId || !targetNodeId)
      throw new Error("source_node_id and target_node_id are required");
    const wc = env._workingCanvas;
    const idx = wc.edges.findIndex((e) => e.source === sourceNodeId && e.target === targetNodeId);
    if (idx === -1) throw new Error("No edge found between these nodes");
    wc.edges.splice(idx, 1);
    return { ok: true, source: sourceNodeId, target: targetNodeId };
  }
  if (!isUUID(projectId)) throw new Error("Invalid project_id");
  if (!sourceNodeId || !targetNodeId)
    throw new Error("source_node_id and target_node_id are required");

  await assertCanvasUnlocked(env, projectId, userId);

  const wfRes = await scopedQuery(env, userId, "projects", {
    query: `id=eq.${projectId}&select=canvas,canvas_version&limit=1`,
  });
  if (!wfRes.ok) throw new Error("Failed to fetch workflow");
  const rows = (await wfRes.json()) as Array<{
    canvas: { nodes: CanvasNode[]; edges: CanvasEdge[] };
    canvas_version: number;
  }>;
  if (!rows.length) throw new Error("Workflow not found");

  const canvas = rows[0].canvas;
  const canvasVersion = rows[0].canvas_version;
  const edges: CanvasEdge[] = canvas.edges ?? [];
  const removedEdge = edges.find(
    (e) => e.source === sourceNodeId && e.target === targetNodeId,
  );
  if (!removedEdge) throw new Error("No edge found between these nodes");

  const updatedEdges = edges.filter((e) => e !== removedEdge);
  const updatedCanvas = { ...canvas, edges: updatedEdges };
  const edgeResult = await patchCanvasWithVersion(
    env,
    projectId,
    canvasVersion,
    () => updatedCanvas as unknown as Record<string, unknown>,
    userId,
  );
  if (!edgeResult.ok && edgeResult.conflict) {
    throw new Error(
      "canvas_conflict — canvas was modified concurrently. Re-fetch and retry.",
    );
  }
  if (!edgeResult.ok) throw new Error("Failed to remove edge");

  // Best-effort: clean up injected env vars from Vercel when a synced edge is removed
  const edgeData = removedEdge.data as { synced?: boolean; envVars?: string[] } | undefined;
  if (edgeData?.synced && edgeData.envVars?.length) {
    const tgtNode = (canvas.nodes ?? []).find((n) => n.id === targetNodeId);
    const tgtData = tgtNode?.data as Record<string, unknown> | undefined;
    if ((tgtData?.provider as string) === "vercel" && tgtData?.vercelProjectId) {
      try {
        const token = await getUserToken(env, userId, "vercel");
        await Promise.allSettled(
          edgeData.envVars.map((key) =>
            deleteVercelEnvVar(token, tgtData.vercelProjectId as string, key),
          ),
        );
      } catch {
        // Token unavailable — skip silently; Vercel vars are stale but non-critical
      }
    }
  }

  auditLog(env, userId, "edge_removed", {
    projectId,
    sourceNodeId,
    targetNodeId,
    source: "mcp",
  });
  return { ok: true, source: sourceNodeId, target: targetNodeId };
}

export async function listVercelProjects(userId: string, env: Env) {
  const token = await getUserToken(env, userId, "vercel");
  const res = await fetch("https://api.vercel.com/v9/projects?limit=100", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Vercel API error: ${res.status}`);
  const data = await res.json<{
    projects: Array<{
      id: string;
      name: string;
      framework: string | null;
      targets?: { production?: { alias?: string[] } };
    }>;
  }>();
  return {
    projects: (data.projects ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      framework: p.framework,
      production_url: p.targets?.production?.alias?.[0] ?? null,
    })),
  };
}

export async function listGithubRepos(userId: string, env: Env) {
  const token = await getUserToken(env, userId, "github");
  const repos = await listRepos(token);
  return {
    repos: repos.map((r) => ({
      full_name: r.full_name,
      description: (r as any).description ?? null,
      private: (r as any).private ?? false,
      default_branch: (r as any).default_branch ?? "main",
    })),
  };
}

export async function listSupabaseProjects(userId: string, env: Env) {
  const token = await getUserToken(env, userId, "supabase");
  const res = await fetch("https://api.supabase.com/v1/projects", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Supabase API error: ${res.status}`);
  const projects =
    await res.json<
      Array<{ id: string; name: string; region: string; status: string }>
    >();
  return {
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      region: p.region,
      status: p.status,
    })),
  };
}

export async function listEnvironments(projectId: string, userId: string, env: Env) {
  const result = await listEnvironmentsData(projectId, userId, env);
  if (result && typeof result === "object" && !Array.isArray(result) && "error" in result)
    throw new Error(result.error);
  return result;
}

export async function importFromBuilder(
  userId: string,
  env: Env,
  args: { repo_url?: string },
) {
  const repoUrl = typeof args.repo_url === "string" ? args.repo_url : "";
  if (!repoUrl) throw new Error("repo_url is required");
  return analyzeRepo(env, userId, repoUrl);
}
