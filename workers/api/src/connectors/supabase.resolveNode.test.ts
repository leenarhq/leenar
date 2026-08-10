import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveSupabaseNode } from "./supabase";

const env = { SUPABASE_URL: "https://x", SUPABASE_SERVICE_ROLE_KEY: "k" } as any;

function mockCanvas(nodes: unknown[]) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => [{ canvas: { nodes, edges: [] } }],
  } as unknown as Response);
}

describe("resolveSupabaseNode", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns ref + provisioned:true for a provisioned supabase node", async () => {
    mockCanvas([{ id: "n1", data: { provider: "supabase", supabaseProjectRef: "abc-ref" } }]);
    expect(await resolveSupabaseNode(env, "u1", "p1", "n1")).toEqual({
      ref: "abc-ref",
      provisioned: true,
    });
  });

  it("returns provisioned:false when no ref yet", async () => {
    mockCanvas([{ id: "n1", data: { provider: "supabase" } }]);
    expect(await resolveSupabaseNode(env, "u1", "p1", "n1")).toEqual({
      ref: null,
      provisioned: false,
    });
  });

  it("throws for a non-supabase node", async () => {
    mockCanvas([{ id: "n1", data: { provider: "vercel" } }]);
    await expect(resolveSupabaseNode(env, "u1", "p1", "n1")).rejects.toThrow(/not a Supabase/);
  });
});
