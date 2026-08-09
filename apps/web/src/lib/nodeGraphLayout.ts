/**
 * Mobile edge geometry for the landing `NodeGraph`. Nodes stack vertically and
 * right-aligned; every edge is routed through a left-side "rail" so that branch
 * edges (source connected to a node two rows down) bow out to the left and never
 * cross the node(s) in between. All coordinates are relative to the SVG's
 * container origin, matching the desktop `measure()` convention.
 */
export interface RailArgs {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

export interface RailPath {
  d: string;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  labelX: number;
  labelY: number;
}

export function verticalRailPath({ sx, sy, tx, ty }: RailArgs): RailPath {
  const span = Math.abs(ty - sy);
  // Deeper bow for longer spans so stacked branch edges fan out and read as
  // distinct wires; clamped so the curve never leaves the container.
  const bow = Math.min(64, 20 + span * 0.22);
  const controlX = Math.max(6, Math.min(sx, tx) - bow);
  const d = `M ${sx} ${sy} C ${controlX} ${sy}, ${controlX} ${ty}, ${tx} ${ty}`;
  return {
    d,
    sx,
    sy,
    tx,
    ty,
    labelX: sx - 8, // sits just left of the source node edge (text-anchor="end")
    // Bias the label toward the source (not the exact midpoint) so a long
    // wrap-around edge's label doesn't land dead-center on top of a short
    // edge's midpoint label.
    labelY: sy + (ty - sy) * 0.35,
  };
}
