import { describe, it, expect, vi, afterEach } from "vitest";
import { branchGitHub } from "./github";

afterEach(() => vi.restoreAllMocks());

type FetchCall = { url: string; init?: RequestInit };

function makeFetchSpy(
  responses: Array<{ status: number; body?: unknown; text?: string }>,
) {
  let idx = 0;
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const { status, body, text } = responses[idx++] ?? { status: 200 };
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => null },
        json: async () => body ?? {},
        text: async () => text ?? JSON.stringify(body ?? {}),
      };
    }),
  );
  return calls;
}

describe("branchGitHub", () => {
  it("creates a branch off the given source branch", async () => {
    const calls = makeFetchSpy([
      { status: 404 }, // target ref does not exist yet
      { status: 200, body: { object: { sha: "abc123" } } }, // source ref
      { status: 201, body: { object: { sha: "abc123" } } }, // create ref
    ]);
    const out = await branchGitHub("tok", {
      repo: "acme/app",
      fromBranch: "main",
      branchKey: "staging",
    });
    expect(out).toEqual({ github_branch: "staging", github_branch_sha: "abc123" });
    // Third call is the POST that creates refs/heads/staging
    const create = calls[2];
    expect(create.url).toContain("/repos/acme/app/git/refs");
    expect(create.init?.method).toBe("POST");
    expect(JSON.parse(create.init!.body as string)).toEqual({
      ref: "refs/heads/staging",
      sha: "abc123",
    });
  });

  it("is idempotent: reuses an existing branch without creating", async () => {
    const calls = makeFetchSpy([
      { status: 200, body: { object: { sha: "deadbeef" } } }, // target ref exists
    ]);
    const out = await branchGitHub("tok", {
      repo: "acme/app",
      fromBranch: "main",
      branchKey: "staging",
    });
    expect(out).toEqual({
      github_branch: "staging",
      github_branch_sha: "deadbeef",
    });
    expect(calls).toHaveLength(1); // no source lookup, no create
  });

  it("treats a 422 on create (race) as success", async () => {
    makeFetchSpy([
      { status: 404 }, // target ref missing
      { status: 200, body: { object: { sha: "sha1" } } }, // source ref
      { status: 422, text: "Reference already exists" }, // create loses race
    ]);
    const out = await branchGitHub("tok", {
      repo: "acme/app",
      fromBranch: "main",
      branchKey: "staging",
    });
    expect(out.github_branch).toBe("staging");
    expect(out.github_branch_sha).toBe("sha1");
  });

  it("resolves the default branch when fromBranch is omitted", async () => {
    const calls = makeFetchSpy([
      { status: 200, body: { default_branch: "trunk" } }, // repo lookup
      { status: 404 }, // target ref missing
      { status: 200, body: { object: { sha: "s" } } }, // source ref (trunk)
      { status: 201, body: { object: { sha: "s" } } }, // create
    ]);
    await branchGitHub("tok", { repo: "acme/app", branchKey: "staging" });
    // The source-ref lookup must reference the resolved default branch "trunk"
    expect(calls[2].url).toContain("/git/ref/heads/trunk");
  });

  it("throws when the source branch is missing", async () => {
    makeFetchSpy([
      { status: 404 }, // target missing
      { status: 404, text: "Not Found" }, // source missing
    ]);
    await expect(
      branchGitHub("tok", {
        repo: "acme/app",
        fromBranch: "nope",
        branchKey: "staging",
      }),
    ).rejects.toThrow(/source branch/);
  });
});
