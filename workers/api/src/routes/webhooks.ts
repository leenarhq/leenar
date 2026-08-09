import { Hono } from 'hono'
import type { Env } from '../types'
import { isUUID, auditLog } from '../utils'
import { isSafeWebhookUrl, isSlackUrl, buildSlackBody, sign as signPayload } from '../webhookDispatch'
import { provisioningHooks } from '../hooks/provisioningHooks'

export const webhooksRouter = new Hono<{
  Bindings: Env
  Variables: { userId: string }
}>()

const VALID_EVENTS = ['deploy_succeeded', 'deploy_failed', 'drift_detected', 'autopilot_action_taken', 'autopilot_needs_approval'] as const

function sbH(env: Env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  }
}

// GET /api/webhooks
webhooksRouter.get('/', async (c) => {
  const userId = c.get('userId')
  const res = await fetch(
    `${c.env.SUPABASE_URL}/rest/v1/user_webhooks?user_id=eq.${userId}&order=created_at.desc&select=id,url,events,active,created_at`,
    { headers: sbH(c.env) },
  )
  if (!res.ok) return c.json({ error: 'Failed to fetch webhooks' }, 502)
  return c.json(await res.json())
})

// Shared logic — used by both the REST route and the MCP `create_webhook` tool.
type WebhookRow = {
  id?: string
  user_id?: string
  url?: string
  secret?: string
  events?: string[]
  active?: boolean
  created_at?: string
}

export async function createWebhookData(
  url: string | undefined,
  events: string[] | undefined,
  userId: string,
  env: Env,
): Promise<{ error: string; status: 400 | 429 | 502 } | (WebhookRow & { secret: string })> {
  if (!(await provisioningHooks.rateLimit.check(env, userId, 'webhook_create', 20, 60_000))) {
    return { error: 'Too many requests. Please slow down.', status: 429 }
  }

  if (!url?.trim()) return { error: 'url required', status: 400 }
  if (!(await isSafeWebhookUrl(url)))
    return { error: 'URL must be https and must not point to a private address', status: 400 }

  const validEvents = (events ?? [...VALID_EVENTS]).filter((e) =>
    (VALID_EVENTS as readonly string[]).includes(e),
  )
  if (validEvents.length === 0) return { error: 'at least one valid event required', status: 400 }

  // Existing webhook count guard — max 10 per user (fail-closed: error on DB failure)
  const countRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_webhooks?user_id=eq.${userId}&select=id`,
    { headers: sbH(env) },
  )
  if (!countRes.ok) return { error: 'Failed to validate quota', status: 502 }
  const rows = (await countRes.json()) as unknown[]
  if (rows.length >= 10) return { error: 'Maximum 10 webhooks per account', status: 400 }

  const secretBytes = new Uint8Array(32)
  crypto.getRandomValues(secretBytes)
  const secret = [...secretBytes].map((b) => b.toString(16).padStart(2, '0')).join('')

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/user_webhooks`, {
    method: 'POST',
    headers: { ...sbH(env), Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: userId, url: url.trim(), secret, events: validEvents, active: true }),
  })
  if (!res.ok) return { error: 'Failed to create webhook', status: 502 }
  const [row] = (await res.json()) as WebhookRow[]
  auditLog(env, userId, 'webhook_created', { webhookId: row?.id, events: validEvents })
  // Return secret only on creation — never again
  return { ...row, secret }
}

// POST /api/webhooks
webhooksRouter.post('/', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json<{ url?: string; events?: string[] }>()
  const result = await createWebhookData(body.url, body.events, userId, c.env)
  if ('error' in result) return c.json({ error: result.error }, result.status)
  return c.json(result, 201)
})

// Shared logic — used by both the REST route and the MCP `delete_webhook` tool.
export async function deleteWebhookData(
  webhookId: string,
  userId: string,
  env: Env,
): Promise<{ error: string; status: 400 | 502 } | { ok: true }> {
  if (!isUUID(webhookId)) return { error: 'Invalid id', status: 400 }

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_webhooks?id=eq.${webhookId}&user_id=eq.${userId}`,
    { method: 'DELETE', headers: sbH(env) },
  )
  if (!res.ok) return { error: 'Failed to delete webhook', status: 502 }
  auditLog(env, userId, 'webhook_deleted', { webhookId })
  return { ok: true }
}

// DELETE /api/webhooks/:id
webhooksRouter.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  if (!isUUID(id)) return c.json({ error: 'Invalid id' }, 400)
  const result = await deleteWebhookData(id, userId, c.env)
  if ('error' in result) return c.json({ error: result.error }, result.status)
  return c.json(result)
})

// Shared logic — used by both the REST route and the MCP `test_webhook` tool.
export async function testWebhookData(
  webhookId: string,
  userId: string,
  env: Env,
): Promise<
  | { error: string; status: 400 | 404 | 429 | 502 }
  | { ok: boolean; error?: string }
> {
  if (!isUUID(webhookId)) return { error: 'Invalid id', status: 400 }

  if (!(await provisioningHooks.rateLimit.check(env, userId, 'webhook_test', 10, 60_000))) {
    return { error: 'Too many requests. Please slow down.', status: 429 }
  }

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_webhooks?id=eq.${webhookId}&user_id=eq.${userId}&select=url,secret,events`,
    { headers: sbH(env) },
  )
  if (!res.ok) return { error: 'Service unavailable', status: 502 }
  const [wh] = (await res.json()) as Array<{ url: string; secret: string; events: string[] }>
  if (!wh) return { error: 'Webhook not found', status: 404 }

  // Re-validate URL before dispatching — defense-in-depth against stale stored URLs
  if (!(await isSafeWebhookUrl(wh.url))) return { error: 'Webhook URL no longer valid', status: 400 }

  const slack = isSlackUrl(wh.url)
  const payload = slack
    ? buildSlackBody('deploy_succeeded', { projectName: 'test-project' }, true)
    : JSON.stringify({
        event: 'deploy_succeeded',
        timestamp: new Date().toISOString(),
        workflowId: '00000000-0000-0000-0000-000000000000',
        stackId: '00000000-0000-0000-0000-000000000000',
        projectName: 'test-project',
        test: true,
      })

  try {
    const sig = await signPayload(wh.secret, payload)
    const resp = await fetch(wh.url, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        'X-Leenar-Signature': sig,
        'X-Leenar-Event': 'deploy_succeeded',
        'User-Agent': 'Leenar-Webhook/1.0',
      },
      body: payload,
      signal: AbortSignal.timeout(5000),
    })
    return { ok: resp.ok }
  } catch {
    return { ok: false, error: 'delivery_failed' }
  }
}

// POST /api/webhooks/:id/test
webhooksRouter.post('/:id/test', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  if (!isUUID(id)) return c.json({ error: 'Invalid id' }, 400)
  const result = await testWebhookData(id, userId, c.env)
  if ('error' in result && 'status' in result) return c.json({ error: result.error }, result.status)
  return c.json(result)
})
