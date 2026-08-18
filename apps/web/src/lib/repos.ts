import type { GitHubRepo } from "./api";
import { timeAgo } from "./utils";

/**
 * The one dim line under a repo's name.
 *
 * Both halves are optional on purpose — see the GitHubRepo docblock in
 * lib/api.ts. When neither date parses there is no honest thing to say about
 * time, so the line degrades to the branch alone rather than guessing.
 */
export function repoMeta(repo: GitHubRepo): string {
  const raw = repo.pushed_at ?? repo.updated_at;
  const ms = raw ? new Date(raw).getTime() : NaN;
  const when = Number.isNaN(ms) ? null : `pushed ${timeAgo(ms)}`;
  const branch = repo.default_branch ?? null;
  return [when, branch].filter(Boolean).join(" · ");
}

/**
 * The env-key count, as the cell renders it.
 *
 * Zero is the empty string, not "0 env keys": a repo that declares no env
 * vars has nothing to warn you about, and a row of zeroes across the grid is
 * noise where the point of the number was weight. Same reason repoMeta drops a
 * half it cannot fill.
 */
export function envKeyLabel(n: number): string {
  if (n <= 0) return "";
  return n === 1 ? "1 env key" : `${n} env keys`;
}

/** `github.com/owner/name`, with or without a scheme or a trailing slash. */
const REPO_URL =
  /(?:^|\/\/)(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

export function looksLikeRepoUrl(query: string): boolean {
  return REPO_URL.test(query.trim());
}

/**
 * One field does both jobs: it filters the grid as you type, and it accepts a
 * pasted repo URL. There is no separate import entry point because the whole
 * page is the import.
 *
 * A pasted URL narrows to exactly that repo instead of running as a substring
 * match — "https://github.com/acme/api" contains "github", which as a
 * substring would match nothing useful and would read as a broken paste.
 */
export function filterRepos(repos: GitHubRepo[], query: string): GitHubRepo[] {
  const q = query.trim();
  if (!q) return repos;

  const url = REPO_URL.exec(q);
  if (url) {
    const full = `${url[1]}/${url[2]}`.toLowerCase();
    return repos.filter((r) => r.full_name.toLowerCase() === full);
  }

  const needle = q.toLowerCase();
  return repos.filter((r) => r.full_name.toLowerCase().includes(needle));
}
