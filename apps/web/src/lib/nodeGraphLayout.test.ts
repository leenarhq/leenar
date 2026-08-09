import { describe, it, expect } from "vitest";
import { verticalRailPath } from "./nodeGraphLayout";

// First control point x from a "M sx sy C cx cy, ..." path string.
const controlX = (d: string) =>
  Number(d.split(" C ")[1].split(",")[0].trim().split(" ")[0]);

describe("verticalRailPath", () => {
  it("bows the curve into a gutter left of both node edges", () => {
    // Two nodes whose left edges sit at x=130, stacked vertically.
    const p = verticalRailPath({ sx: 130, sy: 20, tx: 130, ty: 160 });
    // Control x must be left of the node edge (a left-side rail).
    expect(controlX(p.d)).toBeLessThan(130);
    // Endpoints are preserved.
    expect(p.d.startsWith("M 130 20 C")).toBe(true);
    expect(p.d.endsWith("130 160")).toBe(true);
  });

  it("bows deeper for longer vertical spans but never past the container edge", () => {
    const near = verticalRailPath({ sx: 130, sy: 0, tx: 130, ty: 40 });
    const far = verticalRailPath({ sx: 130, sy: 0, tx: 130, ty: 400 });
    const cx = (p: { d: string }) => controlX(p.d);
    expect(cx(far)).toBeLessThan(cx(near)); // deeper (further left) for longer spans
    expect(cx(far)).toBeGreaterThanOrEqual(6); // clamped, never off-canvas
  });

  it("anchors the label at the source left edge, biased toward the source", () => {
    const p = verticalRailPath({ sx: 130, sy: 20, tx: 130, ty: 160 });
    expect(p.labelX).toBe(122); // sx - 8, grows leftward via text-anchor=end
    expect(p.labelY).toBeCloseTo(69); // sy + (ty - sy) * 0.35
    // Biased toward the source, not the exact midpoint (which would be 90).
    expect(p.labelY).toBeLessThan(90);
  });
});
