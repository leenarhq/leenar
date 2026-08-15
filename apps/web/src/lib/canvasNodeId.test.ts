import { describe, it, expect } from "vitest";
import { remapCanvasNodeId } from "./canvasNodeId";

describe("remapCanvasNodeId", () => {
  it("moves the node and both edge ends onto the server-minted id", () => {
    const out = remapCanvasNodeId(
      {
        nodes: [
          { id: "vercel-1", data: { provider: "vercel" } },
          { id: "supabase-1", data: { provider: "supabase", imported: true } },
        ],
        edges: [
          { id: "e1", source: "vercel-1", target: "supabase-1" },
          { id: "e2", source: "supabase-1", target: "vercel-1" },
        ],
      },
      "supabase-1",
      "service-9f1c",
    );
    expect(out.nodes.map((n) => n.id)).toEqual(["vercel-1", "service-9f1c"]);
    // The node's authoring data rides along unchanged.
    expect(out.nodes[1].data).toEqual({ provider: "supabase", imported: true });
    // No edge may still point at the placeholder — that would be a dangling
    // edge and deploy rejects the canvas.
    expect(out.edges).toEqual([
      { id: "e1", source: "vercel-1", target: "service-9f1c" },
      { id: "e2", source: "service-9f1c", target: "vercel-1" },
    ]);
  });

  it("leaves nodes and edges that do not mention the id alone", () => {
    const canvas = {
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [{ id: "e", source: "a", target: "b" }],
    };
    expect(remapCanvasNodeId(canvas, "missing", "x")).toEqual(canvas);
  });
});
