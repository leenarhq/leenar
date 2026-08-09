import { Hono } from 'hono'
import type { Env } from '../types'
import { isUUID, auditLog } from '../utils'
import { scopedQuery } from '../tenancy'

export const apiKeysRouter = new Hono<{ Bindings: Env; Variables: { userId: string } }>()

function sbH(env: Env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  }
}

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function randomKey(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, 'x')
    .replace(/\//g, 'y')
    .replace(/=/g, '')
  return `lnr_${b64}`
}

// GET /api/keys  →  list user's API keys (no hashes exposed)
apiKeysRouter.get('/', async (c) => {
  const userId = c.get('userId')
  const res = await scopedQuery(c.env, userId, 'api_keys', {
    query: `order=created_at.desc&select=id,name,key_prefix,scope,created_at,last_used_at`,
  })
  if (!res.ok) return c.json({ error: 'Failed to fetch keys' }, 500)
  return c.json(await res.json())
})

// Shared logic — used by both the REST route and the MCP `create_api_key` tool.
// Never trust raw input for scope; whitelist to 'read' | 'write', default 'read'.
export async function createApiKey(
  name: string | undefined,
  scope: string | undefined,
  userId: string,
  env: Env,
): Promise<{ error: string; status: 400 | 500 } | { id: string; name: string; key_prefix: string; scope: string; created_at: string; key: string }> {
  const cleanName = (name ?? 'My API Key').trim().slice(0, 64)
  if (!cleanName) return { error: 'Name is required', status: 400 }
  const cleanScope = scope === 'write' ? 'write' : 'read'

  const raw = randomKey()
  const hash = await sha256hex(raw)
  const prefix = raw.slice(0, 12)

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/api_keys`, {
    method: 'POST',
    headers: { ...sbH(env), Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: userId, name: cleanName, key_hash: hash, key_prefix: prefix, scope: cleanScope }),
  })
  if (!res.ok) {
    const err = await res.text()
    if (err.includes('Maximum of 10')) return { error: 'Maximum of 10 API keys allowed', status: 400 }
    return { error: 'Failed to create key', status: 500 }
  }
  const rows = await res.json() as Array<{ id: string; name: string; key_prefix: string; scope: string; created_at: string }>

  auditLog(env, userId, 'api_key_created', { name: cleanName, keyId: rows[0]?.id, scope: cleanScope })
  // Return raw key once — never stored
  return { ...rows[0], key: raw }
}

// Shared logic — used by both the REST route and the MCP `delete_api_key` tool.
export async function deleteApiKey(
  id: string,
  userId: string,
  env: Env,
): Promise<{ error: string; status: 400 | 500 } | { ok: true }> {
  if (!isUUID(id)) return { error: 'Invalid id', status: 400 }

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/api_keys?id=eq.${id}&user_id=eq.${userId}`,
    { method: 'DELETE', headers: sbH(env) },
  )
  if (!res.ok) return { error: 'Failed to revoke key', status: 500 }

  auditLog(env, userId, 'api_key_revoked', { keyId: id })
  return { ok: true }
}

// POST /api/keys  →  create a new API key (raw key returned once)
apiKeysRouter.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json<{ name?: string; scope?: string }>().catch(() => ({ name: undefined, scope: undefined }))
  const result = await createApiKey(body.name, body.scope, userId, c.env)
  if ('error' in result) return c.json({ error: result.error }, result.status)
  return c.json(result, 201)
})

// DELETE /api/keys/:id  →  revoke a key
apiKeysRouter.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const result = await deleteApiKey(id, userId, c.env)
  if ('error' in result) return c.json({ error: result.error }, result.status)
  return c.json(result)
})

// Exported helper — used by auth middleware to verify lnr_ tokens
export async function verifyApiKey(
  raw: string,
  env: Env,
): Promise<{ userId: string; scope: 'read' | 'write' } | null> {
  if (!raw.startsWith('lnr_')) return null
  const hash = await sha256hex(raw)

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/api_keys?key_hash=eq.${hash}&select=id,user_id,scope&limit=1`,
    { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } },
  )
  if (!res.ok) return null
  const rows = await res.json() as Array<{ id: string; user_id: string; scope: 'read' | 'write' | null }>
  if (!rows[0]) return null

  // Fire-and-forget last_used_at update
  fetch(`${env.SUPABASE_URL}/rest/v1/api_keys?id=eq.${rows[0].id}`, {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ last_used_at: new Date().toISOString() }),
  }).catch(() => {})

  return { userId: rows[0].user_id, scope: rows[0].scope ?? 'read' }
}
