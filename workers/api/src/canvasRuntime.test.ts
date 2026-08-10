import { describe, it, expect } from "vitest";
import {
  RUNTIME_NODE_KEYS,
  RUNTIME_EDGE_KEYS,
  stripRuntimeFromCanvas,
  stripRuntimeFromCanvasForNewEnvironment,
} from "./canvasRuntime";

describe("RUNTIME_NODE_KEYS", () => {
  it("matches the frontend's RUNTIME_KEYS list", () => {
    const expected = [
      "status",
      "provisionedAt",
      "stackId",
      "errorMsg",
      "desiredEnvKeys",
      "provisionedUrl",
      "vercelProjectId",
      "supabaseProjectRef",
      "githubRepoName",
      "githubRepoUrl",
      "cfWorkerNameProvisioned",
      "cfBucketNameProvisioned",
      "cloudflareWorkerUrl",
      "cloudflareAccountId",
      "r2Endpoint",
      "driftCount",
      "incidentCount",
      "incidents",
      "usage",
      "branchMode",
      "branchKey",
      "githubBranch",
      "vercelBranchAlias",
      "supabaseCloneRef",
    ];
    expect([...RUNTIME_NODE_KEYS].sort()).toEqual(expected.sort());
    expect(RUNTIME_NODE_KEYS.size).toBe(expected.length);
  });
});

describe("stripRuntimeFromCanvas", () => {
  it("returns non-object input unchanged", () => {
    expect(stripRuntimeFromCanvas(null)).toBe(null);
    expect(stripRuntimeFromCanvas(undefined)).toBe(undefined);
    expect(stripRuntimeFromCanvas("nope")).toBe("nope");
  });

  it("strips all runtime keys from every node's data", () => {
    const canvas = {
      nodes: [
        {
          id: "n1",
          type: "service",
          data: {
            provider: "vercel",
            label: "Vercel",
            status: "provisioned",
            provisionedUrl: "https://evil.example.com",
            driftCount: 3,
          },
        },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
    };
    const result = stripRuntimeFromCanvas(canvas) as {
      nodes: Array<{ data: Record<string, unknown> }>;
      edges: unknown[];
    };
    expect(result.nodes[0].data).toEqual({
      provider: "vercel",
      label: "Vercel",
    });
    expect(result.nodes[0].data.status).toBeUndefined();
    expect(result.nodes[0].data.provisionedUrl).toBeUndefined();
    expect(result.nodes[0].data.driftCount).toBeUndefined();
    // edges/other top-level fields preserved (data normalized to {})
    expect(result.edges).toEqual([{ id: "e1", source: "n1", target: "n2", data: {} }]);
  });

  it("preserves viewport and other top-level canvas fields", () => {
    const canvas = {
      nodes: [],
      edges: [],
      viewport: { x: 1, y: 2, zoom: 1 },
    };
    const result = stripRuntimeFromCanvas(canvas) as Record<string, unknown>;
    expect(result.viewport).toEqual({ x: 1, y: 2, zoom: 1 });
  });

  it("defaults nodes to an empty array when missing", () => {
    const result = stripRuntimeFromCanvas({ edges: [] }) as {
      nodes: unknown[];
    };
    expect(result.nodes).toEqual([]);
  });

  it("does NOT strip synced or markerEnd from edges (regression guard: normal saves must preserve synced edge state)", () => {
    const canvas = {
      nodes: [],
      edges: [
        {
          id: "e1",
          source: "n1",
          target: "n2",
          markerEnd: { type: "arrowclosed", color: "#34d399" },
          data: {
            envVars: ["DATABASE_URL"],
            synced: true,
          },
        },
      ],
    };
    const result = stripRuntimeFromCanvas(canvas) as {
      edges: Array<{ data: Record<string, unknown>; markerEnd?: unknown }>;
    };
    expect(result.edges[0].data).toEqual({
      envVars: ["DATABASE_URL"],
      synced: true,
    });
    expect(result.edges[0].markerEnd).toEqual({
      type: "arrowclosed",
      color: "#34d399",
    });
  });

  it("defaults edges to an empty array when missing", () => {
    const result = stripRuntimeFromCanvas({ nodes: [] }) as {
      edges: unknown[];
    };
    expect(result.edges).toEqual([]);
  });
});

describe("RUNTIME_EDGE_KEYS", () => {
  it("contains the synced flag set post-deploy by useDeployFlow.ts", () => {
    expect([...RUNTIME_EDGE_KEYS]).toEqual(["synced"]);
  });
});

describe("stripRuntimeFromCanvasForNewEnvironment", () => {
  it("strips synced and markerEnd from edges, preserving authoring intent (envVars)", () => {
    const canvas = {
      nodes: [],
      edges: [
        {
          id: "e1",
          source: "n1",
          target: "n2",
          markerEnd: { type: "arrowclosed", color: "#34d399" },
          data: {
            envVars: ["DATABASE_URL"],
            synced: true,
          },
        },
      ],
    };
    const result = stripRuntimeFromCanvasForNewEnvironment(canvas) as {
      edges: Array<{ data: Record<string, unknown>; markerEnd?: unknown }>;
    };
    expect(result.edges[0].data).toEqual({ envVars: ["DATABASE_URL"] });
    expect(result.edges[0].data.synced).toBeUndefined();
    expect(result.edges[0].markerEnd).toBeUndefined();
  });

  it("also strips node runtime keys (same behavior as stripRuntimeFromCanvas)", () => {
    const canvas = {
      nodes: [
        {
          id: "n1",
          type: "service",
          data: {
            provider: "vercel",
            label: "Vercel",
            status: "provisioned",
            provisionedUrl: "https://evil.example.com",
          },
        },
      ],
      edges: [],
    };
    const result = stripRuntimeFromCanvasForNewEnvironment(canvas) as {
      nodes: Array<{ data: Record<string, unknown> }>;
    };
    expect(result.nodes[0].data).toEqual({
      provider: "vercel",
      label: "Vercel",
    });
  });

  it("defaults edges to an empty array when missing", () => {
    const result = stripRuntimeFromCanvasForNewEnvironment({
      nodes: [],
    }) as { edges: unknown[] };
    expect(result.edges).toEqual([]);
  });

  it("returns non-object input unchanged", () => {
    expect(stripRuntimeFromCanvasForNewEnvironment(null)).toBe(null);
  });
});
