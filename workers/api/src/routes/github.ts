import { Hono } from 'hono'
import type { Env } from '../types'
import { getUserToken } from '../utils'
import { listRepos, listBranches } from '../connectors/github'
import { provisioningHooks } from '../hooks/provisioningHooks'
import { summarizeRepo, type RepoSummary } from '../repoScan'
import { cachedJson } from '../edgeCache'

export const github = new Hono<{ Bindings: Env; Variables: { userId: string } }>()

github.get('/repos', async (c) => {
  const userId = c.get('userId')
  try {
    const token = await getUserToken(c.env, userId, 'github')
    const repos = await listRepos(token)
    return c.json(repos)
  } catch (e: unknown) {
    console.error('github.repos_failed', e instanceof Error ? e.message : String(e))
    return c.json({ error: 'Failed to fetch repositories. Please reconnect your GitHub account.' }, 500)
  }
})

github.get('/branches', async (c) => {
  const userId = c.get('userId')
  const repo = c.req.query('repo')
  if (!repo || !/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(repo)) {
    return c.json({ error: 'repo query param must be owner/repo format' }, 400)
  }
  try {
    const token = await getUserToken(c.env, userId, 'github')
    const branches = await listBranches(token, repo)
    return c.json(branches)
  } catch (e: unknown) {
    console.error('github.branches_failed', e instanceof Error ? e.message : String(e))
    return c.json({ error: 'Failed to fetch branches. Please reconnect your GitHub account.' }, 500)
  }
})

/** Same shape the /branches handler validates against. */
const REPO_FULL_NAME = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/

/** Twenty repos is one screen's worth of grid and sixty-odd upstream fetches;
 *  the frontend batches anything larger. */
const MAX_REPOS = 20

const SUMMARY_TTL_S = 600

/**
 * POST /api/github/repos/summary — the env-key count, the detected stack and
 * "is there an app here" for a batch of repos.
 *
 * Not /api/projects/from-repo in a loop: that runs the full analysis — repo
 * info, a monorepo workspace probe, a Supabase ownership lookup — behind a
 * 20-per-5-minutes limit, which a forty-cell grid cannot pay. This costs one
 * GitHub API call per repo (see repoScan.ts) and caches for ten minutes.
 *
 * The cache key carries the user id. Repo *content* is not user-specific but
 * *access* to it is, and a shared key would let one user request a private
 * full_name they cannot read and be handed the summary another user's token
 * produced.
 */
github.post('/repos/summary', async (c) => {
  const userId = c.get('userId')

  if (!(await provisioningHooks.rateLimit.check(c.env, userId, 'repo-summary', 20, 5 * 60_000))) {
    return c.json({ error: 'Too many requests. Please wait a few minutes.' }, 429)
  }

  const body = await c.req.json<{ repos?: unknown }>().catch(() => ({}))
  const raw = (body as { repos?: unknown }).repos
  if (!Array.isArray(raw)) return c.json({ error: 'repos must be an array of owner/repo names' }, 400)

  const repos = [
    ...new Set(raw.filter((r): r is string => typeof r === 'string' && REPO_FULL_NAME.test(r))),
  ].slice(0, MAX_REPOS)
  if (!repos.length) return c.json({ summaries: {} })

  // No token is not an error: the scan still works for public repos, and the
  // caller has a grid to draw either way.
  let token: string | null = null
  try {
    token = await getUserToken(c.env, userId, 'github')
  } catch {
    /* not connected */
  }

  const origin = new URL(c.req.url).origin
  const results = await Promise.all(
    repos.map((full) =>
      cachedJson<RepoSummary | null>(
        origin,
        `repo-summary/v1/${encodeURIComponent(userId)}/${encodeURIComponent(full)}`,
        SUMMARY_TTL_S,
        () => summarizeRepo(full, token),
      ).catch(() => null),
    ),
  )

  const summaries: Record<string, RepoSummary> = {}
  for (const s of results) if (s) summaries[s.full_name] = s
  return c.json({ summaries })
})
