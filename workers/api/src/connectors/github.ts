import { createLogger } from "../logger";
import { assertNotRateLimited } from "./errors";

const GH_API = "https://api.github.com";
const log = createLogger({ connector: "github" });

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "Leenar/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export function toRepoName(projectName: string): string {
  return (
    projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "my-project"
  );
}

export interface GitHubRepo {
  id: number;
  full_name: string;
  name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  updated_at: string;
}

/**
 * Verify an existing GitHub repo exists and is reachable with the given token.
 * Used by the import-node route to confirm a repo before persisting it as a
 * canvas node. Throws on failure — a 404 throws an Error whose message
 * contains "not found" so the route handler can map it to a 400 response.
 */
export async function verifyRepo(
  token: string,
  fullName: string,
): Promise<{ full_name: string; html_url: string; default_branch: string }> {
  const res = await fetch(`${GH_API}/repos/${fullName}`, {
    headers: ghHeaders(token),
    signal: AbortSignal.timeout(10_000),
  });
  assertNotRateLimited(res);
  if (res.status === 404) {
    throw new Error(`GitHub repo not found: ${fullName}`);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `GitHub repo verify failed: ${res.status} ${body.slice(0, 200)}`,
    );
  }
  const data = await res.json<{
    full_name: string;
    html_url: string;
    default_branch: string;
  }>();
  return {
    full_name: data.full_name,
    html_url: data.html_url,
    default_branch: data.default_branch,
  };
}

export async function listRepos(token: string): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${GH_API}/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
      { headers: ghHeaders(token), signal: AbortSignal.timeout(30_000) },
    );
    assertNotRateLimited(res);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(
        `GitHub repos failed: ${res.status} ${err.slice(0, 100)}`,
      );
    }
    const batch = await res.json<GitHubRepo[]>();
    if (!batch.length) break;
    repos.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return repos;
}

export interface GitHubBranch {
  name: string;
  protected: boolean;
}

export async function listBranches(
  token: string,
  repoFullName: string,
): Promise<GitHubBranch[]> {
  const branches: GitHubBranch[] = [];
  let page = 1;
  while (page <= 5) {
    const res = await fetch(
      `${GH_API}/repos/${repoFullName}/branches?per_page=100&page=${page}`,
      {
        headers: ghHeaders(token),
        signal: AbortSignal.timeout(30_000),
      },
    );
    assertNotRateLimited(res);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(
        `GitHub branches failed: ${res.status} ${err.slice(0, 100)}`,
      );
    }
    const batch = await res.json<GitHubBranch[]>();
    if (!batch.length) break;
    branches.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return branches;
}

export interface GitHubOutput {
  github_repo_url: string;
  github_clone_url: string;
  github_repo_name: string;
  github_default_branch: string;
}

export async function provisionGitHub(
  token: string,
  params: { existing_repo?: string | null },
  projectName: string,
): Promise<GitHubOutput> {
  // No existing repo provided → skip creation, return empty (Vercel will work without GitHub)
  if (!params.existing_repo) {
    return {
      github_repo_url: "",
      github_clone_url: "",
      github_repo_name: "",
      github_default_branch: "main",
    };
  }

  if (params.existing_repo) {
    // Parse owner/repo directly from the URL — no GitHub API call needed
    const repoPath = params.existing_repo
      .replace(/^https?:\/\/github\.com\//, "")
      .replace(/\.git$/, "")
      .replace(/#.*$/, "")
      .trim();
    // Must be exactly owner/repo — no path traversal, no extra segments
    if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(repoPath)) {
      throw new Error(
        `Invalid repository format: must be owner/repo (got: ${params.existing_repo})`,
      );
    }
    // Fetch the actual default branch — don't assume "main"
    let defaultBranch = "main";
    try {
      const repoRes = await fetch(`${GH_API}/repos/${repoPath}`, {
        headers: ghHeaders(token),
        signal: AbortSignal.timeout(10_000),
      });
      if (repoRes.ok) {
        const repoData = await repoRes.json<{ default_branch?: string }>();
        defaultBranch = repoData.default_branch ?? "main";
      }
    } catch {
      /* non-fatal: fall back to "main" */
    }
    return {
      github_repo_url: `https://github.com/${repoPath}`,
      github_clone_url: `https://github.com/${repoPath}.git`,
      github_repo_name: repoPath,
      github_default_branch: defaultBranch,
    };
  }

  // Create new private repo
  const name = toRepoName(projectName);
  const res = await fetch(`${GH_API}/user/repos`, {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({
      name,
      private: true,
      auto_init: true,
      description: `Created by Leenar`,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  assertNotRateLimited(res);
  if (!res.ok) {
    const body = await res.text();
    let message = `GitHub error ${res.status}: ${body.slice(0, 200)}`;
    let nameAlreadyExists = false;
    try {
      const err = JSON.parse(body) as {
        message?: string;
        errors?: { message: string }[];
      };
      message = err.message ?? message;
      nameAlreadyExists = !!err.errors?.some((e) =>
        e.message?.includes("already exists"),
      );
    } catch {
      /* body was not JSON */
    }

    // Name already taken → append timestamp suffix and retry
    if (nameAlreadyExists) {
      const fallback = `${name}-${Date.now().toString(36)}`;
      const retry = await fetch(`${GH_API}/user/repos`, {
        method: "POST",
        headers: ghHeaders(token),
        body: JSON.stringify({
          name: fallback,
          private: true,
          auto_init: true,
          description: "Created by Leenar",
        }),
        signal: AbortSignal.timeout(30_000),
      });
      assertNotRateLimited(retry);
      if (!retry.ok) {
        const retryBody = await retry.text();
        throw new Error(
          `GitHub repo creation failed: ${retryBody.slice(0, 200)}`,
        );
      }
      const data = await retry.json<{
        html_url: string;
        clone_url: string;
        full_name: string;
        default_branch: string;
      }>();
      return {
        github_repo_url: data.html_url,
        github_clone_url: data.clone_url,
        github_repo_name: data.full_name,
        github_default_branch: data.default_branch,
      };
    }
    throw new Error(`GitHub repo creation failed: ${message}`);
  }

  const data = await res.json<{
    html_url: string;
    clone_url: string;
    full_name: string;
    default_branch: string;
  }>();
  return {
    github_repo_url: data.html_url,
    github_clone_url: data.clone_url,
    github_repo_name: data.full_name,
    github_default_branch: data.default_branch,
  };
}

/** Push a minimal marker commit to the repo, attributed to the deploy brand. */
export async function pushLeenarCommit(
  token: string,
  repoFullName: string,
  brand: { name: string; url: string; email: string },
): Promise<void> {
  const content = btoa(`${brand.url}\n`);
  const res = await fetch(`${GH_API}/repos/${repoFullName}/contents/.leenar`, {
    method: "PUT",
    headers: ghHeaders(token),
    body: JSON.stringify({
      message: `Added: ${brand.name}`,
      content,
      author: { name: brand.name, email: brand.email },
      committer: { name: brand.name, email: brand.email },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text();
    log.warn("commit.push_failed", {
      status: res.status,
      body: body.slice(0, 100),
    });
  }
}

export interface BranchGitHubOutput {
  /** The branch that now exists (created or already present). */
  github_branch: string;
  /** SHA the branch points at. */
  github_branch_sha: string;
}

/**
 * Create a git branch `branchKey` off `fromBranch` (native branching). Idempotent:
 * if the branch already exists it is reused (its current SHA returned), NOT reset —
 * we must never rewind a branch that may already carry branch work.
 *
 * `fromBranch` defaults to the repo's default branch when omitted (resolved via the
 * repo API), so callers that only know `repo` don't need to look it up first.
 */
export async function branchGitHub(
  token: string,
  params: { repo: string; fromBranch?: string; branchKey: string },
): Promise<BranchGitHubOutput> {
  const { repo, branchKey } = params;

  // Resolve the source branch (default branch if not given).
  let fromBranch = params.fromBranch;
  if (!fromBranch) {
    const repoRes = await fetch(`${GH_API}/repos/${repo}`, {
      headers: ghHeaders(token),
      signal: AbortSignal.timeout(30_000),
    });
    assertNotRateLimited(repoRes);
    if (!repoRes.ok) {
      const body = await repoRes.text();
      throw new Error(
        `GitHub repo lookup failed: ${repoRes.status} ${body.slice(0, 100)}`,
      );
    }
    fromBranch = (await repoRes.json<{ default_branch: string }>())
      .default_branch;
  }

  // Idempotency: if the target branch already exists, reuse it as-is.
  const existingRes = await fetch(
    `${GH_API}/repos/${repo}/git/ref/heads/${encodeURIComponent(branchKey)}`,
    { headers: ghHeaders(token), signal: AbortSignal.timeout(30_000) },
  );
  assertNotRateLimited(existingRes);
  if (existingRes.ok) {
    const ref = await existingRes.json<{ object: { sha: string } }>();
    return { github_branch: branchKey, github_branch_sha: ref.object.sha };
  }

  // Get the source branch tip SHA to branch from.
  const srcRes = await fetch(
    `${GH_API}/repos/${repo}/git/ref/heads/${encodeURIComponent(fromBranch)}`,
    { headers: ghHeaders(token), signal: AbortSignal.timeout(30_000) },
  );
  assertNotRateLimited(srcRes);
  if (!srcRes.ok) {
    const body = await srcRes.text();
    throw new Error(
      `GitHub source branch "${fromBranch}" not found: ${srcRes.status} ${body.slice(0, 100)}`,
    );
  }
  const srcSha = (await srcRes.json<{ object: { sha: string } }>()).object.sha;

  const createRes = await fetch(`${GH_API}/repos/${repo}/git/refs`, {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({ ref: `refs/heads/${branchKey}`, sha: srcSha }),
    signal: AbortSignal.timeout(30_000),
  });
  assertNotRateLimited(createRes);
  // 422 "Reference already exists" — a concurrent create won the race; reuse it.
  if (createRes.status === 422) {
    return { github_branch: branchKey, github_branch_sha: srcSha };
  }
  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(
      `GitHub branch create failed: ${createRes.status} ${body.slice(0, 120)}`,
    );
  }
  const created = await createRes.json<{ object: { sha: string } }>();
  return { github_branch: branchKey, github_branch_sha: created.object.sha };
}

/**
 * Monthly-cumulative GitHub Actions paid minutes for the account that owns a repo.
 * Tries the user billing endpoint first, then the org endpoint (owner may be either).
 * Returns paid minutes used this billing cycle, or null if unavailable. The caller
 * converts this cumulative figure into a daily delta.
 */
export async function getGitHubActionsPaidMinutes(
  token: string,
  owner: string,
): Promise<number | null> {
  const paths = [
    `/users/${owner}/settings/billing/actions`,
    `/orgs/${owner}/settings/billing/actions`,
  ];
  for (const path of paths) {
    try {
      const res = await fetch(`${GH_API}${path}`, {
        headers: ghHeaders(token),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 404 || res.status === 403) continue;
      if (!res.ok) continue;
      const json = await res.json<{ total_paid_minutes_used?: number }>().catch(() => null);
      if (json && typeof json.total_paid_minutes_used === "number") {
        return json.total_paid_minutes_used;
      }
    } catch {
      // try next path
    }
  }
  return null;
}
