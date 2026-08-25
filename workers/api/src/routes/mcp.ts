// The open-core edition's tool registry. Staged over routes/mcp.ts at export
// (manifest.json transforms), the same mechanism as index.core.ts.
//
// The cloud registry is a 3,400-line file whose tools reach deploys, drift
// reconciliation, incident mutation, cost and API-key management — the
// autonomy surface the core/cloud split keeps closed. Rather than ship it and
// rely on a scope check at the call site to hold the line, core ships a
// registry that physically cannot dispatch those tools.
//
// The handlers themselves are NOT duplicated here: both editions import them
// from routes/mcpCanvasTools.ts, so the canvas semantics have exactly one
// definition. This file is only the dispatch table.
import type { Env } from "../types";
import { isUUID } from "../utils";
import {
  CANVAS_ALLOWED_TOOLS,
  CANVAS_TOOL_SCHEMAS,
  resolveProjectIdByName,
  listWorkflows,
  getCanvas,
  listEnvironments,
  listConnectionsTool,
  listVercelProjects,
  listGithubRepos,
  listSupabaseProjects,
  addService,
  connectServices,
  updateNode,
  removeNode,
  removeEdge,
  importFromBuilder,
} from "./mcpCanvasTools";
import { getWorkflowEnvVars } from "../insights/collectors";
import { createMcpRouter } from "./mcpTransport";

export const TOOLS = CANVAS_TOOL_SCHEMAS;
export { CANVAS_ALLOWED_TOOLS };

// Core has no dashboard agent — routes/agent.ts is cloud-only and the closure
// prune drops it. An empty set keeps agentRuntime.ts's import resolving without
// giving that surface a tool.
export const DASHBOARD_ALLOWED_TOOLS = new Set<string>();

// The read half of the canvas tools. This set is NOT the allow/deny line — the
// deny line is TOOLS above, which is the whole registry a core client can even
// see. This is the read/write line the transport applies to API keys: a tool
// left out of it needs a write-scoped key, exactly as in cloud.
//
// Split by effect, not by name: the five authoring tools plus import_from_builder
// are what a read-only token must not reach.
export const API_KEY_ALLOWED_TOOLS = new Set<string>([
  "list_workflows",
  "get_canvas",
  "list_environments",
  "list_connections",
  "get_workflow_env_vars",
  "list_vercel_projects",
  "list_github_repos",
  "list_supabase_projects",
  "import_from_builder",
]);

// Same JSON-RPC transport the cloud registry uses (routes/mcpTransport.ts), so
// a client cannot tell the two servers apart at the protocol level — only by
// what tools/list returns. registerCoreRoutes mounts this at /api/mcp; the
// export stages this file over routes/mcp.ts, so that import resolves here.
export const mcpRouter = createMcpRouter({
  tools: TOOLS,
  apiKeyAllowedTools: API_KEY_ALLOWED_TOOLS,
  callTool,
});

/**
 * Signature-compatible with the cloud callTool — agentRuntime.ts passes all six
 * arguments and neither edition may special-case which registry it got.
 *
 * The cloud version's destructive-confirmation gate has no counterpart here:
 * every tool below is either read-only or an in-memory working-canvas edit, and
 * cloud itself skips that gate whenever env._workingCanvas is set — which is
 * always, on the only path that reaches this file (runAgent seeds it for
 * scope:"canvas"). There is no tool here for a gate to protect.
 */
export async function callTool(
  name: string,
  args: Record<string, string>,
  userId: string,
  env: Env,
  source = "mcp",
  allowedTools?: ReadonlySet<string>,
): Promise<unknown> {
  // Same hard server-side scope gate the cloud registry applies, kept so a
  // hallucinated or injection-induced tool_call is rejected identically in both
  // editions rather than falling through to the "Unknown tool" throw.
  if (allowedTools && !allowedTools.has(name)) {
    return { error: `Tool "${name}" is not permitted for this session.` };
  }

  if (source !== "mcp") env = { ...env, _auditSource: source };

  // A non-UUID project_id is a workflow name — resolve it the same way cloud
  // does, so "add a repo to my blog" works without the model guessing a UUID.
  if (args.project_id && !isUUID(args.project_id)) {
    args = {
      ...args,
      project_id: await resolveProjectIdByName(args.project_id, userId, env),
    };
  }

  switch (name) {
    case "list_workflows":
      return listWorkflows(userId, env);
    case "get_canvas":
      return getCanvas(args.project_id, userId, env);
    case "list_environments":
      return listEnvironments(args.project_id, userId, env);
    case "list_connections":
      return listConnectionsTool(userId, env);
    case "get_workflow_env_vars":
      return getWorkflowEnvVars(args.project_id, userId, env);
    case "list_vercel_projects":
      return listVercelProjects(userId, env);
    case "list_github_repos":
      return listGithubRepos(userId, env);
    case "list_supabase_projects":
      return listSupabaseProjects(userId, env);
    case "import_from_builder":
      return importFromBuilder(userId, env, args as { repo_url?: string });
    case "add_service":
      return addService(args.project_id, args.provider, userId, env);
    case "connect_services":
      return connectServices(
        args.project_id,
        args.source_node_id,
        args.target_node_id,
        userId,
        env,
      );
    case "update_node":
      return updateNode(
        args.project_id,
        args.node_id,
        (args as unknown as { updates?: Record<string, unknown> }).updates ?? {},
        userId,
        env,
      );
    case "remove_node":
      return removeNode(args.project_id, args.node_id, userId, env);
    case "remove_edge":
      return removeEdge(
        args.project_id,
        args.source_node_id,
        args.target_node_id,
        userId,
        env,
      );
    default:
      // Reached only if a caller widens the scope; every cloud tool lands here.
      throw new Error(`Unknown tool: ${name}`);
  }
}
