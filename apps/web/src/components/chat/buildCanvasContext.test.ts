import { describe, it, expect } from "vitest";
import { buildCanvasContext } from "./buildCanvasContext";
import type { SimpleEdge, SimpleNode } from "./chatTypes";

const svc = (
  id: string,
  over: Partial<SimpleNode["data"]> = {},
): SimpleNode => ({
  id,
  type: "service",
  data: { label: id, provider: id, ...over },
});

const edge = (
  source: string,
  target: string,
  data?: SimpleEdge["data"],
): SimpleEdge => ({ id: `${source}-${target}`, source, target, data });

describe("buildCanvasContext", () => {
  it("says the canvas is empty rather than describing nothing", () => {
    expect(buildCanvasContext([], [])).toBe(
      "Canvas is empty — no service nodes yet.",
    );
  });

  it("marks a node with no service edges as isolated", () => {
    const ctx = buildCanvasContext([svc("github"), svc("vercel")], []);

    expect(ctx).toContain("(no connections — isolated)");
    expect(ctx).toContain("Canvas edges: none");
  });

  it("does not count an edge to a non-service node as a connection", () => {
    // The reason the filter exists: a note or a group attached to a service
    // would otherwise make an isolated node look wired.
    const note: SimpleNode = { id: "note", type: "annotation" };
    const ctx = buildCanvasContext(
      [svc("github"), note],
      [edge("github", "note")],
    );

    expect(ctx).toContain("(no connections — isolated)");
    expect(ctx).toContain("Canvas edges: none");
  });

  it("tells the model an env-carrying edge has not been deployed yet", () => {
    const ctx = buildCanvasContext(
      [svc("supabase"), svc("vercel")],
      [
        edge("supabase", "vercel", {
          envVars: ["SUPABASE_URL"],
          synced: false,
        }),
      ],
    );

    expect(ctx).toContain("envVars:SUPABASE_URL");
    expect(ctx).toContain("[NOT synced — deploy needed]");
  });

  it("distinguishes a config edge from one that carries nothing yet", () => {
    const ctx = buildCanvasContext(
      [svc("github"), svc("vercel")],
      [edge("github", "vercel")],
    );

    expect(ctx).toContain("[config edge — no env vars]");
  });

  it("omits a draft status but reports every other one", () => {
    const draft = buildCanvasContext([svc("vercel", { status: "draft" })], []);
    const live = buildCanvasContext(
      [svc("vercel", { status: "provisioned" })],
      [],
    );

    expect(draft).not.toContain("status:");
    expect(live).toContain("status:provisioned");
  });

  it("carries the environment, and names the others when there are any", () => {
    const ctx = buildCanvasContext([svc("vercel")], [], {
      workflowName: "acme",
      currentEnvName: "production",
      currentEnvIsDefault: true,
      environments: [
        { name: "production", slug: "prod", is_default: true },
        { name: "staging", slug: "stg", is_default: false },
      ],
    });

    expect(ctx).toContain("Workflow: acme");
    expect(ctx).toContain("Environment: production (default/production)");
    expect(ctx).toContain("Other environments: staging");
  });

  it("passes only the last ten deploy log lines", () => {
    const ctx = buildCanvasContext([svc("vercel")], [], {
      deployLogs: Array.from({ length: 12 }, (_, i) => ({
        time: "00:00",
        source: "deploy",
        msg: `line-${i}`,
        type: "info" as const,
      })),
    });

    expect(ctx).not.toContain("line-1\n");
    expect(ctx).toContain("line-11");
    expect(ctx).toContain("line-2");
  });
});
