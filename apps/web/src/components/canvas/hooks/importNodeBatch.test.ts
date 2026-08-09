import { describe, it, expect } from "vitest";

/**
 * Regression coverage for the batch-import data-loss bug (see WorkspaceCanvas's
 * handleImportNode). ImportIntoCanvasModal.handleImport calls onImportNode
 * sequentially, in a loop, using the SAME closure/reference for the whole batch.
 *
 * The buggy version read `nodes` from the enclosing render closure (a snapshot
 * taken when the callback was created) and did:
 *
 *   const newNodes = [...nodes, node];
 *   setNodes(newNodes);
 *
 * Because `nodes` never changes across iterations of the loop (no re-render
 * happens between synchronous-ish awaited calls in the same tick group / the
 * closure is fixed), the 2nd+ import in a batch overwrote the canvas with a
 * value that dropped every previously-imported node except the last.
 *
 * The fix uses a functional update so each import reads the latest state at
 * apply-time:
 *
 *   setNodes((nds) => {
 *     const next = [...nds, node];
 *     resetBaseline(next, edges);
 *     return next;
 *   });
 *
 * This test simulates React's setState-updater-queue semantics directly
 * (without mounting React, since this project's vitest environment is "node"
 * and no component harness exists for WorkspaceCanvas/ImportIntoCanvasModal)
 * to prove the functional-update pattern composes correctly across a
 * sequential multi-import batch, while the value-capture pattern reproduces
 * the data loss.
 */

type Node = { id: string };

/** Minimal model of React's queued functional setState: each call receives
 *  the result of the previous call, not a snapshot from before the batch. */
function applyFunctionalUpdates(
  initial: Node[],
  updaters: Array<(prev: Node[]) => Node[]>,
): Node[] {
  return updaters.reduce((state, update) => update(state), initial);
}

describe("batch import node composition", () => {
  it("functional update composes correctly: every imported node survives a sequential batch", () => {
    const initial: Node[] = [{ id: "existing" }];
    let baseline: Node[] | null = null;
    const resetBaseline = (n: Node[]) => {
      baseline = n;
    };

    // Simulates handleImportNode's fixed body, called once per loop iteration
    // with a fresh imported node, using the SAME closure both times (as
    // ImportIntoCanvasModal.handleImport does: it doesn't re-obtain
    // onImportNode between iterations).
    const makeImportUpdater = (node: Node) => (nds: Node[]) => {
      const next = [...nds, node];
      resetBaseline(next);
      return next;
    };

    const nodeA = { id: "vercel-a" };
    const nodeB = { id: "supabase-b" };

    const finalNodes = applyFunctionalUpdates(initial, [
      makeImportUpdater(nodeA),
      makeImportUpdater(nodeB),
    ]);

    // Both imported nodes, plus the pre-existing one, must all survive.
    expect(finalNodes.map((n) => n.id)).toEqual([
      "existing",
      "vercel-a",
      "supabase-b",
    ]);
    // The autosave baseline must reflect the same final set, not a
    // truncated intermediate one.
    expect(baseline).toEqual(finalNodes);
  });

  it("reproduces the historical bug: closure-captured value updates silently drop earlier imports in the same batch", () => {
    const initial: Node[] = [{ id: "existing" }];
    let canvasState: Node[] = initial;
    let baseline: Node[] | null = null;
    const resetBaseline = (n: Node[]) => {
      baseline = n;
    };

    // Simulates the OLD buggy handleImportNode: `nodes` is captured once
    // from the render closure and never advances across loop iterations,
    // because ImportIntoCanvasModal holds one fixed onImportNode reference
    // for the whole batch and no re-render occurs between iterations.
    const staleNodesClosure = initial;
    const buggyImport = (node: Node) => {
      const newNodes = [...staleNodesClosure, node];
      canvasState = newNodes; // setNodes(newNodes) equivalent
      resetBaseline(newNodes);
    };

    const nodeA = { id: "vercel-a" };
    const nodeB = { id: "supabase-b" };

    buggyImport(nodeA);
    buggyImport(nodeB);

    // Demonstrates the data loss: nodeA is missing from both the canvas
    // state and the autosave baseline after the second import.
    expect(canvasState.map((n) => n.id)).toEqual(["existing", "supabase-b"]);
    expect(canvasState.map((n) => n.id)).not.toContain("vercel-a");
    expect(baseline).toEqual(canvasState);
  });
});
