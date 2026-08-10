import { describe, it, expect } from "vitest";
import { branchStrategy } from "./branchStrategy";

describe("branchStrategy", () => {
  it("GitHub is always native with no suffix", () => {
    expect(branchStrategy("github", "staging")).toEqual({
      mode: "native",
      namingSuffix: "",
    });
    // capability is ignored for GitHub
    expect(
      branchStrategy("github", "staging", { vercelGitHubLinked: false }),
    ).toEqual({ mode: "native", namingSuffix: "" });
  });

  it("Vercel is native when git-linked, isolated otherwise", () => {
    expect(
      branchStrategy("vercel", "staging", { vercelGitHubLinked: true }),
    ).toEqual({ mode: "native", namingSuffix: "" });
    expect(
      branchStrategy("vercel", "staging", { vercelGitHubLinked: false }),
    ).toEqual({ mode: "isolated", namingSuffix: "-staging" });
    // missing capability defaults to isolated (safe fallback)
    expect(branchStrategy("vercel", "staging")).toEqual({
      mode: "isolated",
      namingSuffix: "-staging",
    });
  });

  it("Supabase is always isolated (schema-clone), regardless of capability", () => {
    expect(branchStrategy("supabase", "staging")).toEqual({
      mode: "isolated",
      namingSuffix: "-staging",
    });
    expect(
      branchStrategy("supabase", "staging", { vercelGitHubLinked: true }),
    ).toEqual({ mode: "isolated", namingSuffix: "-staging" });
  });

  it("Cloudflare is always native with a name suffix", () => {
    expect(branchStrategy("cloudflare", "staging")).toEqual({
      mode: "native",
      namingSuffix: "-staging",
    });
  });

  it("suffix tracks the branch key", () => {
    expect(branchStrategy("cloudflare", "feat-x").namingSuffix).toBe("-feat-x");
    expect(branchStrategy("supabase", "hotfix").namingSuffix).toBe("-hotfix");
  });
});
