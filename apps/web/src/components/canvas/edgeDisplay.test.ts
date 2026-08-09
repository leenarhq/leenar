import { describe, it, expect } from "vitest";
import {
  isEnvEdge,
  envBadgeForNode,
  edgeRevealed,
  normalizeHandles,
  needsAutoLayout,
  type EdgeLike,
} from "./edgeDisplay";

const env = (source: string, target: string, vars: string[]): EdgeLike => ({
  source,
  target,
  data: { envVars: vars },
});
const structural = (source: string, target: string): EdgeLike => ({
  source,
  target,
  data: { envVars: [] },
});

describe("isEnvEdge", () => {
  it("true only when envVars present", () => {
    expect(isEnvEdge(env("a", "b", ["X"]))).toBe(true);
    expect(isEnvEdge(structural("a", "b"))).toBe(false);
    expect(isEnvEdge({ source: "a", target: "b" })).toBe(false);
    expect(isEnvEdge({ source: "a", target: "b", data: null })).toBe(false);
  });
});

describe("envBadgeForNode", () => {
  it("sums incoming env vars and counts distinct sources", () => {
    const edges = [
      env("supabase", "vercel", ["SUPABASE_URL", "SUPABASE_ANON_KEY"]),
      env("resend", "vercel", ["RESEND_API_KEY"]),
      env("supabase", "cloudflare", ["SUPABASE_URL"]),
      structural("github", "vercel"),
    ];
    expect(envBadgeForNode("vercel", edges)).toEqual({
      vars: 3,
      sources: ["supabase", "resend"],
    });
    expect(envBadgeForNode("cloudflare", edges)).toEqual({
      vars: 1,
      sources: ["supabase"],
    });
    expect(envBadgeForNode("github", edges)).toEqual({ vars: 0, sources: [] });
  });
});

describe("edgeRevealed", () => {
  const e = env("supabase", "vercel", ["X"]);
  it("structural edges always revealed", () => {
    expect(edgeRevealed(structural("github", "vercel"), null)).toBe(true);
  });
  it("env edges hidden unless active node is an endpoint", () => {
    expect(edgeRevealed(e, null)).toBe(false);
    expect(edgeRevealed(e, "other")).toBe(false);
    expect(edgeRevealed(e, "vercel")).toBe(true);
    expect(edgeRevealed(e, "supabase")).toBe(true);
  });
});

describe("normalizeHandles", () => {
  it("pins source-right / target-left, preserves other fields", () => {
    expect(
      normalizeHandles({
        source: "a",
        target: "b",
        sourceHandle: "source-left",
        targetHandle: "target-right",
      }),
    ).toEqual({
      source: "a",
      target: "b",
      sourceHandle: "source-right",
      targetHandle: "target-left",
    });
  });
});

describe("needsAutoLayout", () => {
  it("false for <2 nodes", () => {
    expect(needsAutoLayout([])).toBe(false);
    expect(needsAutoLayout([{ position: { x: 5, y: 5 } }])).toBe(false);
  });
  it("true when a position is missing or origin", () => {
    expect(
      needsAutoLayout([
        { position: { x: 0, y: 0 } },
        { position: { x: 9, y: 9 } },
      ]),
    ).toBe(true);
    expect(needsAutoLayout([{}, { position: { x: 9, y: 9 } }])).toBe(true);
  });
  it("true when two nodes overlap, false when all distinct", () => {
    expect(
      needsAutoLayout([
        { position: { x: 10, y: 10 } },
        { position: { x: 10, y: 10 } },
      ]),
    ).toBe(true);
    expect(
      needsAutoLayout([
        { position: { x: 10, y: 10 } },
        { position: { x: 400, y: 10 } },
      ]),
    ).toBe(false);
  });
});
