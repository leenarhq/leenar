import { Hono } from 'hono'
import type { Env } from '../types'
import { isUUID, auditLog } from '../utils'

export const stacks = new Hono<{ Bindings: Env; Variables: { userId: string } }>()

const SB_HEADERS = (env: Env) => ({
  'Content-Type': 'application/json',
  'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
})

// GET /stacks
stacks.get('/', async (c) => {
  const userId = c.get('userId')
  const res = await fetch(
    `${c.env.SUPABASE_URL}/rest/v1/stacks?user_id=eq.${userId}&order=created_at.desc&limit=100`,
    { headers: SB_HEADERS(c.env) },
  )
  if (!res.ok) return c.json({ error: 'Service unavailable' }, 502)
  return c.json(await res.json())
})

// GET /stacks/:id
stacks.get('/:id', async (c) => {
  const userId = c.get('userId')
  const id     = c.req.param('id')
  if (!isUUID(id)) return c.json({ error: 'Invalid id' }, 400)
  const res = await fetch(
    `${c.env.SUPABASE_URL}/rest/v1/stacks?id=eq.${id}&user_id=eq.${userId}&limit=1`,
    { headers: SB_HEADERS(c.env) },
  )
  const rows = await res.json() as unknown[]
  if (!rows.length) return c.json({ error: 'Not found' }, 404)
  return c.json(rows[0])
})

// POST /stacks
stacks.post('/', async (c) => {
  const userId = c.get('userId')
  const body   = await c.req.json<{ name: string; requirements?: unknown }>()

  if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0 || body.name.length > 200) {
    return c.json({ error: 'Invalid stack name' }, 400)
  }

  const res = await fetch(`${c.env.SUPABASE_URL}/rest/v1/stacks`, {
    method: 'POST',
    headers: { ...SB_HEADERS(c.env), 'Prefer': 'return=representation' },
    body: JSON.stringify({ user_id: userId, name: body.name, requirements: body.requirements ?? null }),
  })
  if (!res.ok) return c.json({ error: 'Failed to create stack' }, 502)
  const rows = await res.json() as Array<{ id: string }>
  if (!rows[0]?.id) return c.json({ error: 'Failed to create stack' }, 500)
  auditLog(c.env, userId, 'stack_created', { stackId: rows[0].id, name: body.name })
  return c.json(rows[0], 201)
})

// PATCH /stacks/:id  (name, requirements only — status is server-managed)
stacks.patch('/:id', async (c) => {
  const userId = c.get('userId')
  const id     = c.req.param('id')
  if (!isUUID(id)) return c.json({ error: 'Invalid id' }, 400)
  const body   = await c.req.json()

  const allowed = ['name', 'requirements']
  const patch: Record<string, unknown> = {}
  for (const k of allowed) if (k in body) patch[k] = body[k]

  const res = await fetch(
    `${c.env.SUPABASE_URL}/rest/v1/stacks?id=eq.${id}&user_id=eq.${userId}`,
    {
      method: 'PATCH',
      headers: { ...SB_HEADERS(c.env), 'Prefer': 'return=representation' },
      body: JSON.stringify(patch),
    },
  )
  const rows = await res.json() as unknown[]
  if (!rows.length) return c.json({ error: 'Not found' }, 404)
  auditLog(c.env, userId, 'stack_updated', { stackId: id, fields: Object.keys(patch) })
  return c.json(rows[0])
})

// DELETE /stacks/:id
stacks.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const id     = c.req.param('id')
  if (!isUUID(id)) return c.json({ error: 'Invalid id' }, 400)

  const res = await fetch(
    `${c.env.SUPABASE_URL}/rest/v1/stacks?id=eq.${id}&user_id=eq.${userId}`,
    { method: 'DELETE', headers: { ...SB_HEADERS(c.env), 'Prefer': 'return=representation' } },
  )
  const rows = await res.json() as unknown[]
  if (!rows.length) return c.json({ error: 'Not found' }, 404)
  auditLog(c.env, userId, 'stack_deleted', { stackId: id })
  return c.json({ ok: true })
})

// GET /stacks/:id/map  →  services + connections
stacks.get('/:id/map', async (c) => {
  const userId = c.get('userId')
  const id     = c.req.param('id')
  if (!isUUID(id)) return c.json({ error: 'Invalid id' }, 400)

  // Verify ownership
  const ownerRes = await fetch(
    `${c.env.SUPABASE_URL}/rest/v1/stacks?id=eq.${id}&user_id=eq.${userId}&select=id&limit=1`,
    { headers: SB_HEADERS(c.env) },
  )
  const owner = await ownerRes.json() as unknown[]
  if (!owner.length) return c.json({ error: 'Not found' }, 404)

  const svcRes = await fetch(
    `${c.env.SUPABASE_URL}/rest/v1/stack_services?stack_id=eq.${id}`,
    { headers: SB_HEADERS(c.env) },
  )

  if (!svcRes.ok) return c.json({ error: 'Service unavailable' }, 502)
  return c.json({ services: await svcRes.json(), connections: [] })
})
