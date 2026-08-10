import { describe, it, expect } from "vitest";
import { CANVAS_ALLOWED_TOOLS } from "./mcp";

describe("canvas tool scope", () => {
  it("is exactly the 13 read + canvas-authoring tools", () => {
    // Pinned by name. This set is the core edition's entire AI capability
    // surface — anything added here ships to the open-core repo, so a change
    // must be deliberate enough to edit this list.
    expect([...CANVAS_ALLOWED_TOOLS].sort()).toEqual([
      "add_service",
      "connect_services",
      "get_canvas",
      "get_workflow_env_vars",
      "list_connections",
      "list_environments",
      "list_github_repos",
      "list_supabase_projects",
      "list_vercel_projects",
      "list_workflows",
      "remove_edge",
      "remove_node",
      "update_node",
    ]);
  });
});
