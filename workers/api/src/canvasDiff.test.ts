import { describe, it, expect } from "vitest";
import { diffCanvas, isEmptyDiff, isDestructiveOnly, type WorkingCanvas } from "./canvasDiff";

const empty: WorkingCanvas = { nodes: [], edges: [] };

describe("diffCanvas", () => {
  it("reports added nodes as {type,data} in working order", () => {
    const working: WorkingCanvas = {
      nodes: [
        { id: "a", type: "service", data: { provider: "supabase" } },
        { id: "b", type: "service", data: { provider: "vercel" } },
      ],
      edges: [],
    };
    const d = diffCanvas(empty, working);
    expect(d.nodes).toEqual([
      { type: "service", data: { provider: "supabase" } },
      { type: "service", data: { provider: "vercel" } },
    ]);
    expect(d.edges).toEqual([]);
  });

  it("resolves added-edge endpoints: new node → index, existing node → id", () => {
    const original: WorkingCanvas = {
      nodes: [{ id: "existing", type: "service", data: {} }],
      edges: [],
    };
    const working: WorkingCanvas = {
      nodes: [
        { id: "existing", type: "service", data: {} },
        { id: "new1", type: "service", data: { provider: "vercel" } },
      ],
      edges: [{ source: "existing", target: "new1" }],
    };
    const d = diffCanvas(original, working);
    // new1 is the first (index 0) added node; existing keeps its id
    expect(d.edges).toEqual([{ source: "existing", target: 0 }]);
  });

  it("reports removed nodes and data updates", () => {
    const original: WorkingCanvas = {
      nodes: [
        { id: "a", type: "service", data: { label: "old" } },
        { id: "b", type: "service", data: {} },
      ],
      edges: [],
    };
    const working: WorkingCanvas = {
      nodes: [{ id: "a", type: "service", data: { label: "new" } }],
      edges: [],
    };
    const d = diffCanvas(original, working);
    expect(d.remove).toEqual(["b"]);
    expect(d.update).toEqual([{ id: "a", data: { label: "new" } }]);
  });

  it("reports a removed edge whose endpoints still exist as a disconnect", () => {
    const original: WorkingCanvas = {
      nodes: [{ id: "a", type: "service", data: {} }, { id: "b", type: "service", data: {} }],
      edges: [{ source: "a", target: "b" }],
    };
    const working: WorkingCanvas = {
      nodes: [{ id: "a", type: "service", data: {} }, { id: "b", type: "service", data: {} }],
      edges: [],
    };
    const d = diffCanvas(original, working);
    expect(d.disconnect).toEqual([{ from: "a", to: "b" }]);
  });

  it("does NOT emit a disconnect when the edge vanished because a node was removed", () => {
    const original: WorkingCanvas = {
      nodes: [{ id: "a", type: "service", data: {} }, { id: "b", type: "service", data: {} }],
      edges: [{ source: "a", target: "b" }],
    };
    const working: WorkingCanvas = { nodes: [{ id: "a", type: "service", data: {} }], edges: [] };
    const d = diffCanvas(original, working);
    expect(d.remove).toEqual(["b"]);
    expect(d.disconnect).toEqual([]); // node removal drops the edge client-side
  });

  it("is order-independent for node data comparison (no false update)", () => {
    const original: WorkingCanvas = { nodes: [{ id: "a", type: "service", data: { x: 1, y: 2 } }], edges: [] };
    const working: WorkingCanvas = { nodes: [{ id: "a", type: "service", data: { y: 2, x: 1 } }], edges: [] };
    expect(diffCanvas(original, working).update).toEqual([]);
  });

  it("classifies diffs", () => {
    expect(isEmptyDiff(diffCanvas(empty, empty))).toBe(true);
    const removeOnly = diffCanvas(
      { nodes: [{ id: "a", type: "service", data: {} }], edges: [] },
      empty,
    );
    expect(isDestructiveOnly(removeOnly)).toBe(true);
    const additive = diffCanvas(empty, { nodes: [{ id: "a", type: "service", data: {} }], edges: [] });
    expect(isDestructiveOnly(additive)).toBe(false);
  });
});
