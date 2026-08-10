import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveBranchDecision } from "./capabilities";

afterEach(() => vi.restoreAllMocks());

/** assertVercelGitHubLinked calls global fetch against the git-namespaces API.
 *  A non-empty namespaces list = linked; empty = throws internally. */
function stubVercelNamespaces(namespaces: Array<{ slug: string }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ namespaces }),
      text: async () => JSON.stringify({ namespaces }),
    })),
  );
}

describe("resolveBranchDecision", () => {
  it("Vercel → native when GitHub is linked", async () => {
    stubVercelNamespaces([{ slug: "acme" }]);
    const d = await resolveBranchDecision("vercel", "staging", {
      vercelToken: "tok",
      vercelRepoName: "acme/app",
    });
    expect(d).toEqual({ mode: "native", namingSuffix: "" });
  });

  it("Vercel → isolated when GitHub is not linked (no namespaces)", async () => {
    stubVercelNamespaces([]);
    const d = await resolveBranchDecision("vercel", "staging", {
      vercelToken: "tok",
      vercelRepoName: "acme/app",
    });
    expect(d).toEqual({ mode: "isolated", namingSuffix: "-staging" });
  });

  it("Vercel → isolated when the probe throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );
    const d = await resolveBranchDecision("vercel", "staging", {
      vercelToken: "tok",
    });
    expect(d.mode).toBe("isolated");
  });

  it("Vercel → isolated when no token is available", async () => {
    const d = await resolveBranchDecision("vercel", "staging", {});
    expect(d.mode).toBe("isolated");
  });

  it("GitHub → native without any probe", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const d = await resolveBranchDecision("github", "staging");
    expect(d).toEqual({ mode: "native", namingSuffix: "" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Supabase → isolated without any probe", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const d = await resolveBranchDecision("supabase", "staging");
    expect(d).toEqual({ mode: "isolated", namingSuffix: "-staging" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Cloudflare → native with suffix, no probe", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const d = await resolveBranchDecision("cloudflare", "staging");
    expect(d).toEqual({ mode: "native", namingSuffix: "-staging" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
