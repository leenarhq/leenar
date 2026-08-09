export type EdgeLike = {
  source: string;
  target: string;
  data?: { envVars?: string[] } | null;
};

/** True when an edge carries env vars (vs a structural/deploy link). */
export function isEnvEdge(edge: EdgeLike): boolean {
  return !!edge.data?.envVars?.length;
}

/** Aggregate env vars injected INTO a node from its incoming edges. */
export function envBadgeForNode(
  nodeId: string,
  edges: EdgeLike[],
): { vars: number; sources: string[] } {
  const sources: string[] = [];
  let vars = 0;
  for (const e of edges) {
    if (e.target === nodeId && e.data?.envVars?.length) {
      vars += e.data.envVars.length;
      if (!sources.includes(e.source)) sources.push(e.source);
    }
  }
  return { vars, sources };
}

/**
 * F-mode edge visibility. Structural edges are always shown. Env edges are
 * shown only when the active (hovered or selected) node is one of their
 * endpoints — otherwise the info lives in the target node's badge.
 */
export function edgeRevealed(
  edge: EdgeLike,
  activeNodeId: string | null,
): boolean {
  if (!isEnvEdge(edge)) return true;
  if (!activeNodeId) return false;
  return edge.source === activeNodeId || edge.target === activeNodeId;
}

/** Pin handles so flow always reads left→right (source exits right, target enters left). */
export function normalizeHandles<
  T extends { sourceHandle?: string | null; targetHandle?: string | null },
>(params: T): T {
  return {
    ...params,
    sourceHandle: "source-right",
    targetHandle: "target-left",
  };
}

/** A loaded canvas needs auto-layout when positions are unset or overlapping. */
export function needsAutoLayout(
  nodes: Array<{ position?: { x: number; y: number } }>,
): boolean {
  if (nodes.length < 2) return false;
  const seen = new Set<string>();
  for (const n of nodes) {
    const p = n.position;
    if (!p || (p.x === 0 && p.y === 0)) return true;
    const key = `${Math.round(p.x)}:${Math.round(p.y)}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}
