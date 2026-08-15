/**
 * Re-point one canvas node id — and every edge that touches it — at a new id.
 *
 * Needed because POST /import-node mints the node id server-side (it is the
 * key `project_env_node_state` rows are written under), while the canvas that
 * has to carry that node was built client-side with a placeholder id. Getting
 * the edges wrong here is not cosmetic: an edge left pointing at the old id is
 * a dangling edge, which `buildProvisionPlan` rejects at deploy time.
 */
export function remapCanvasNodeId<
  N extends { id: string },
  E extends { source: string; target: string },
>(
  canvas: { nodes: N[]; edges: E[] },
  fromId: string,
  toId: string,
): { nodes: N[]; edges: E[] } {
  return {
    nodes: canvas.nodes.map((n) => (n.id === fromId ? { ...n, id: toId } : n)),
    edges: canvas.edges.map((e) =>
      e.source === fromId || e.target === fromId
        ? {
            ...e,
            source: e.source === fromId ? toId : e.source,
            target: e.target === fromId ? toId : e.target,
          }
        : e,
    ),
  };
}
