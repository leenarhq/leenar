/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";

/**
 * The API writes canvas edges too, and it must not put a colour on one.
 *
 * The frontend renderer (apps/web BlueprintEdge) derives the arrowhead from
 * `data.synced` at paint time, so anything stored here is dead weight that
 * looks authoritative. It was worse than dead: this worker used to write
 * `#34d399` — the retired "provisioned" green — onto freshly proposed edges
 * whose `data.synced` was false, so the arrowhead contradicted its own line.
 *
 * The sibling of this test lives in apps/web.
 */
const MARKER_END_WITH_COLOUR = /markerEnd\s*:\s*\{[^}]*\bcolor\b/;

// This file lives at src/, so `./**/*.ts` covers all of src. Test files are
// excluded: canvasRuntime.test.ts feeds old-shaped rows in as fixtures on
// purpose, because that is what the database still holds.
const files = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("edge marker colour", () => {
  // A glob that silently resolves to nothing would make the assertion below
  // vacuously true.
  it("actually scans the tree it claims to", () => {
    expect(
      Object.keys(files).some((p) => p.endsWith("routes/workflowProvision.ts")),
    ).toBe(true);
  });

  it("is never persisted onto an edge", () => {
    const offenders = Object.entries(files)
      .filter(([path]) => !path.endsWith(".test.ts"))
      .filter(([, content]) => MARKER_END_WITH_COLOUR.test(content))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });
});
