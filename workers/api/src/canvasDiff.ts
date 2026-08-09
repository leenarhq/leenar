// Pure structural canvas diff for the web canvas-editing agent (mode:"canvas").
// The agent mutates an in-memory working canvas via tools; at turn end we diff
// it against the client's snapshot and express the delta in the SAME
// CanvasUpdatePayload shape the legacy XML path produced, so the existing client
// apply path (useAiCanvasUpdate) consumes it unchanged.

import type { CanvasUpdatePayload } from "./conversation";

export interface WorkingNode {
  id: string;
  type?: string;
  position?: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface WorkingEdge {
  id?: string;
  source: string;
  target: string;
  data?: Record<string, unknown>;
}

export interface WorkingCanvas {
  nodes: WorkingNode[];
  edges: WorkingEdge[];
}

// Order-independent stringify so reordered data keys don't read as a change.
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

const edgeKey = (e: { source: string; target: string }): string =>
  `${e.source}->${e.target}`;

export function diffCanvas(
  original: WorkingCanvas,
  working: WorkingCanvas,
): CanvasUpdatePayload {
  const origNodes = original.nodes ?? [];
  const workNodes = working.nodes ?? [];
  const origEdges = original.edges ?? [];
  const workEdges = working.edges ?? [];

  const origById = new Map(origNodes.map((n) => [n.id, n]));
  const workById = new Map(workNodes.map((n) => [n.id, n]));

  // Added nodes (working order preserved); index map for edge resolution.
  const addedNodes = workNodes.filter((n) => !origById.has(n.id));
  const newIndexById = new Map<string, number>();
  addedNodes.forEach((n, i) => newIndexById.set(n.id, i));
  const nodes = addedNodes.map((n) => ({ type: n.type ?? "service", data: n.data ?? {} }));

  // Removed nodes.
  const remove = origNodes.filter((n) => !workById.has(n.id)).map((n) => n.id);

  // Updated nodes (present in both, data changed).
  const update: Array<{ id: string; data: Record<string, unknown> }> = [];
  for (const n of workNodes) {
    const o = origById.get(n.id);
    if (o && stableStringify(o.data) !== stableStringify(n.data)) {
      update.push({ id: n.id, data: n.data ?? {} });
    }
  }

  // Added edges → resolve each endpoint to a new-node index or an existing id.
  const origEdgeKeys = new Set(origEdges.map(edgeKey));
  const workEdgeKeys = new Set(workEdges.map(edgeKey));
  const resolveRef = (nodeId: string): number | string =>
    newIndexById.has(nodeId) ? (newIndexById.get(nodeId) as number) : nodeId;
  const edges = workEdges
    .filter((e) => !origEdgeKeys.has(edgeKey(e)))
    .map((e) => ({ source: resolveRef(e.source), target: resolveRef(e.target) }));

  // Removed edges whose BOTH endpoints still exist (otherwise node removal
  // already drops the edge on the client).
  const disconnect = origEdges
    .filter(
      (e) =>
        !workEdgeKeys.has(edgeKey(e)) && workById.has(e.source) && workById.has(e.target),
    )
    .map((e) => ({ from: e.source, to: e.target }));

  return { nodes, edges, update, remove, disconnect };
}

export function isEmptyDiff(d: CanvasUpdatePayload): boolean {
  return (
    (d.nodes?.length ?? 0) === 0 &&
    (d.edges?.length ?? 0) === 0 &&
    (d.update?.length ?? 0) === 0 &&
    (d.remove?.length ?? 0) === 0 &&
    (d.disconnect?.length ?? 0) === 0
  );
}

export function isDestructiveOnly(d: CanvasUpdatePayload): boolean {
  const additive =
    (d.nodes?.length ?? 0) > 0 || (d.edges?.length ?? 0) > 0 || (d.update?.length ?? 0) > 0;
  const destructive = (d.remove?.length ?? 0) > 0 || (d.disconnect?.length ?? 0) > 0;
  return destructive && !additive;
}
