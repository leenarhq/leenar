import { Hono } from 'hono'
import type { Env } from '../types'
import { getUserToken } from '../utils'
import { createLogger } from '../logger'

const log = createLogger({ route: 'supabase' })

export const supabaseRouter = new Hono<{ Bindings: Env; Variables: { userId: string } }>()

supabaseRouter.get('/projects', async (c) => {
  const userId = c.get('userId')
  try {
    const token = await getUserToken(c.env, userId, 'supabase')
    const res = await fetch('https://api.supabase.com/v1/projects', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const body = await res.text()
      log.error('supabase_projects_failed', { status: res.status, body: body.slice(0, 200) })
      return c.json({ error: `Upstream error (${res.status}). Please try again.` }, 502)
    }
    const data = await res.json() as unknown[]
    return c.json(data)
  } catch (e: unknown) {
    log.error('supabase_projects_error', { error: e instanceof Error ? e.message : String(e) })
    return c.json({ error: 'Failed to fetch Supabase projects. Please try again.' }, 500)
  }
})
