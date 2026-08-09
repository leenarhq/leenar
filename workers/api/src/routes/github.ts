import { Hono } from 'hono'
import type { Env } from '../types'
import { getUserToken } from '../utils'
import { listRepos, listBranches } from '../connectors/github'

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
