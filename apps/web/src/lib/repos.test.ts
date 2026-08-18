import { describe, it, expect } from "vitest";
import { repoMeta, filterRepos, looksLikeRepoUrl, envKeyLabel } from "./repos";
import type { GitHubRepo } from "./api";

function repo(over: Partial<GitHubRepo> = {}): GitHubRepo {
  return {
    id: 1,
    full_name: "acme/app",
    name: "app",
    private: false,
    html_url: "https://github.com/acme/app",
    description: null,
    updated_at: "2026-08-18T00:00:00.000Z",
    pushed_at: "2026-08-18T00:00:00.000Z",
    default_branch: "main",
    ...over,
  };
}

describe("repoMeta", () => {
  it("reads the push time and the default branch", () => {
    const m = repoMeta(
      repo({ pushed_at: new Date(Date.now() - 7_200_000).toISOString() }),
    );
    expect(m).toMatch(/^pushed /);
    expect(m).toMatch(/· main$/);
  });

  // pushed_at is undeclared-but-present today (see the GitHubRepo docblock).
  // If GitHub ever stops sending it, the cell falls back to the field this
  // app has always declared rather than rendering "Invalid Date".
  it("falls back to updated_at when pushed_at is absent", () => {
    const m = repoMeta(repo({ pushed_at: undefined }));
    expect(m).toMatch(/^pushed /);
    expect(m).not.toMatch(/invalid/i);
  });

  it("omits the branch segment entirely when there is no default_branch", () => {
    expect(repoMeta(repo({ default_branch: undefined }))).not.toContain("·");
  });

  it("never renders an unparseable date", () => {
    expect(
      repoMeta(repo({ pushed_at: "not-a-date", updated_at: "also-not" })),
    ).toBe("main");
  });
});

describe("looksLikeRepoUrl", () => {
  it("recognises a pasted GitHub URL", () => {
    expect(looksLikeRepoUrl("https://github.com/acme/app")).toBe(true);
    expect(looksLikeRepoUrl("  github.com/acme/app  ")).toBe(true);
  });

  it("does not fire on an ordinary filter query", () => {
    expect(looksLikeRepoUrl("acme")).toBe(false);
    expect(looksLikeRepoUrl("my-github-thing")).toBe(false);
  });
});

describe("filterRepos", () => {
  const list = [
    repo({ id: 1, full_name: "acme/web", name: "web" }),
    repo({ id: 2, full_name: "acme/api", name: "api" }),
    repo({ id: 3, full_name: "other/web-tools", name: "web-tools" }),
  ];

  it("returns everything for an empty query", () => {
    expect(filterRepos(list, "   ")).toHaveLength(3);
  });

  it("matches on the full name, case-insensitively", () => {
    expect(filterRepos(list, "ACME").map((r) => r.id)).toEqual([1, 2]);
    expect(filterRepos(list, "web").map((r) => r.id)).toEqual([1, 3]);
  });

  // The field doubles as the paste-a-URL field, so a pasted URL must narrow
  // to that one repo rather than returning nothing and looking broken.
  it("narrows to the pasted repo when given a URL", () => {
    expect(
      filterRepos(list, "https://github.com/acme/api").map((r) => r.id),
    ).toEqual([2]);
  });

  it("returns nothing for a URL that is not in the list", () => {
    expect(filterRepos(list, "https://github.com/someone/else")).toEqual([]);
  });
});

describe("envKeyLabel", () => {
  it("says nothing rather than '0 env keys'", () => {
    expect(envKeyLabel(0)).toBe("");
  });

  it("does not pluralise one", () => {
    expect(envKeyLabel(1)).toBe("1 env key");
  });

  it("counts the rest", () => {
    expect(envKeyLabel(14)).toBe("14 env keys");
  });
});
