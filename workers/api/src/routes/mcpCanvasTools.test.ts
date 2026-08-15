import { describe, it, expect } from "vitest";
import { CANVAS_ALLOWED_TOOLS } from "./mcp";
import { CANVAS_TOOL_SCHEMAS } from "./mcpCanvasTools";

describe("canvas tool scope", () => {
  it("is exactly the 14 read + canvas-authoring tools", () => {
    // Pinned by name. This set is the core edition's entire AI capability
    // surface — anything added here ships to the open-core repo, so a change
    // must be deliberate enough to edit this list.
    expect([...CANVAS_ALLOWED_TOOLS].sort()).toEqual([
      "add_service",
      "connect_services",
      "get_canvas",
      "get_workflow_env_vars",
      "import_from_builder",
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

describe("import_from_builder", () => {
  it("is exposed to the canvas tool subset", () => {
    expect(CANVAS_ALLOWED_TOOLS.has("import_from_builder")).toBe(true);
    expect(
      CANVAS_TOOL_SCHEMAS.some((t) => t.name === "import_from_builder"),
    ).toBe(true);
  });
});
