import { Hono } from 'hono'
import type { Env } from '../types'
import { isUUID, auditLog } from '../utils'
import { scopedQuery } from '../tenancy'

export const driftsRouter = new Hono<{
  Bindings: Env
  Variables: { userId: string }
}>()

function sbH(env: Env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  }
}

// GET /api/drifts?projectId=<uuid>  →  open drift records for this project
driftsRouter.get('/', async (c) => {
  const userId    = c.get('userId')
  const projectId = c.req.query('projectId')
  if (!projectId || !isUUID(projectId)) return c.json({ error: 'projectId required' }, 400)

  const res = await scopedQuery(c.env, userId, 'stack_drifts', {
    query: `project_id=eq.${projectId}&resolved_at=is.null&select=id,node_id,service,resource_id,drift_type,field,expected,actual,detected_at&order=detected_at.desc`,
  })
  if (!res.ok) return c.json({ error: 'Failed to fetch drifts' }, 500)
  return c.json(await res.json())
})

// POST /api/drifts/:id/ignore  →  mark a single drift as user-ignored
driftsRouter.post('/:id/ignore', async (c) => {
  const userId  = c.get('userId')
  const driftId = c.req.param('id')
  if (!isUUID(driftId)) return c.json({ error: 'Invalid id' }, 400)

  const res = await fetch(
    `${c.env.SUPABASE_URL}/rest/v1/stack_drifts?id=eq.${driftId}&user_id=eq.${userId}&resolved_at=is.null`,
    {
      method:  'PATCH',
      headers: sbH(c.env),
      body: JSON.stringify({
        resolved_at: new Date().toISOString(),
        resolution:  'ignored',
      }),
    },
  )
  if (!res.ok) return c.json({ error: 'Failed to update drift' }, 500)
  const _src = c.req.query("source");
  const source = _src === "mcp" || _src === "ai_agent" ? _src : "api";
  auditLog(c.env, userId, 'drift_ignored', { driftId, source })
  // Drift badges are derived client-side from GET /api/drifts (useDriftMonitoring
  // refreshes on the drift-check-complete event), so no canvas write is needed.
  return c.json({ ok: true })
})
