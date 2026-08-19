/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";

/**
 * A canvas edge must not carry a colour into the database.
 *
 * BlueprintEdge derives its arrowhead from the same `var()` as its line, so a
 * `markerEnd.color` is at best ignored and at worst a lie. It was a lie three
 * ways before this guard existed: rows written before the redesign held the
 * retired five-hue scheme; the API and the MCP tools wrote `#34d399` onto
 * edges whose `data.synced` was false, so the head claimed provisioned while
 * the line said structural; and the writers that had been corrected called
 * `getComputedStyle` and persisted whatever the theme happened to resolve to,
 * which then survived a theme flip.
 *
 * None of that is reachable by the `no-restricted-syntax` colour guard in
 * eslint.config.js — it reads className literals, and these are object
 * properties on data headed for `projects.canvas`.
 *
 * The sibling of this test lives in workers/api; the writers are on both
 * sides of the wire.
 */
const MARKER_END_WITH_COLOUR = /markerEnd\s*:\s*\{[^}]*\bcolor\b/;

// This file lives at src/components/canvas/, so `../../**` covers all of src.
const files = import.meta.glob("../../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("edge marker colour", () => {
  // A glob that silently resolves to nothing would make every assertion below
  // vacuously true.
  it("actually scans the tree it claims to", () => {
    // Vite keys a glob relative to the importing file, so this one comes back
    // as './BlueprintEdge.tsx' rather than a src-relative path.
    expect(
      Object.keys(files).some((p) => p.endsWith("/BlueprintEdge.tsx")),
    ).toBe(true);
    expect(Object.keys(files).length).toBeGreaterThan(100);
  });

  it("is never persisted onto an edge", () => {
    const offenders = Object.entries(files)
      .filter(([path]) => !path.endsWith("edgeMarker.static.test.ts"))
      .filter(([, content]) => MARKER_END_WITH_COLOUR.test(content))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it("would catch a writer that reintroduced one", () => {
    expect(
      MARKER_END_WITH_COLOUR.test(`markerEnd: { type: "arrowclosed" }`),
    ).toBe(false);
    expect(
      MARKER_END_WITH_COLOUR.test(
        `markerEnd: { type: "arrowclosed", color: "#34d399" }`,
      ),
    ).toBe(true);
    // Multi-line, which is the shape every real offender had.
    expect(
      MARKER_END_WITH_COLOUR.test(
        [
          "markerEnd: {",
          "  type: MarkerType.ArrowClosed,",
          '  color: read("--ok"),',
          "},",
        ].join("\n"),
      ),
    ).toBe(true);
  });
});
