import { decrypt, encrypt } from './crypto'
import type { Env } from './types'

export function sb(env: Env, path: string, init: RequestInit = {}) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...(init.headers as Record<string, string> ?? {}),
    },
    signal: init.signal ?? AbortSignal.timeout(30_000),
  })
}

export type AuthUser = {
  id: string
  email: string
  created_at: string
  user_metadata?: { full_name?: string; name?: string }
}

/**
 * Enumerates every registered account via the Supabase Auth Admin API,
 * paginating until exhausted. Only users with an email are returned. Shared by
 * admin re-engagement sends (routes/adminEmail.ts) and the lifecycle-email
 * engine (lifecycleEmails.ts).
 */
export async function fetchAllAuthUsers(env: Env): Promise<AuthUser[]> {
  const all: AuthUser[] = []
  const perPage = 200
  let page = 1
  for (;;) {
    const res = await fetch(
      `${env.SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    )
    if (!res.ok) break
    const data = await res.json<{ users: AuthUser[] }>()
    const batch = data.users || []
    all.push(...batch.filter((u) => !!u.email))
    if (batch.length < perPage) break
    page++
  }
  return all
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUUID(s: string): boolean {
  return UUID_RE.test(s)
}

/** Constant-time string comparison — avoids leaking secret/signature/token
 *  contents through early-exit timing. Both inputs are compared in full. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// Matches key names that commonly hold secret material (case-insensitive).
// Shared choke point for anything written to a client-readable log/event
// table (provisioning_events, deployment_logs, user_audit_log) so a secret
// accidentally passed into metadata/payload never reaches storage in the clear.
const SECRET_KEY_RE = /secret|password|service_role|private_key|access_key|token|_key$/i

/** Whether a key name commonly holds secret material — reuse this instead of
 *  a separate ad-hoc heuristic wherever a producer needs to decide if a
 *  value it's about to log/track is secret-shaped. */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key)
}

/**
 * Scrubs known secret values out of free-form text (e.g. a provider's raw
 * HTTP error response body) before it is logged or surfaced to a client.
 * Unlike redactPayload (which redacts by key name in structured data), this
 * guards against a provider echoing back a secret value we sent it — e.g. a
 * generated DB password or an env var value — inside an error message.
 */
export function redactSecretsFromText(text: string, secrets: Array<string | undefined>): string {
  let out = text
  for (const secret of secrets) {
    if (!secret) continue
    out = out.split(secret).join('[REDACTED]')
  }
  return out
}

/**
 * Recursively redacts values whose object key looks like a secret.
 * Keys are preserved (only the value is replaced with "[REDACTED]") so
 * consumers can still see which fields exist.
 */
export function redactPayload<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactPayload(item)) as unknown as T
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_RE.test(key) ? '[REDACTED]' : redactPayload(val)
    }
    return out as unknown as T
  }
  return value
}

const VALID_SERVICES = ['github', 'vercel', 'supabase', 'resend', 'cloudflare'] as const

export async function getUserToken(env: Env, userId: string, service: string): Promise<string> {
  if (!(VALID_SERVICES as readonly string[]).includes(service)) {
    throw new Error(`Invalid service: ${service}`)
  }
  const res = await sb(env,
    `user_connections?user_id=eq.${userId}&service=eq.${service}&select=access_token_enc,refresh_token_enc,expires_at&limit=1`,
  )
  if (!res.ok) throw new Error(`Failed to fetch ${service} connection (${res.status})`)
  const rows = await res.json() as Array<{
    access_token_enc:  string
    refresh_token_enc: string | null
    expires_at:        string | null
  }>
  if (!rows.length) throw new Error(`No ${service} connection found`)

  const row       = rows[0]
  const isExpired = row.expires_at ? new Date(row.expires_at) <= new Date(Date.now() + 60_000) : false

  // Attempt Supabase token refresh if expired (only Supabase OAuth issues refresh tokens)
  if (isExpired && row.refresh_token_enc && service === 'supabase') {
    try {
      const refreshToken  = await decrypt(row.refresh_token_enc, env.ENCRYPTION_KEY)
      const credentials   = btoa(`${env.SUPABASE_CLIENT_ID}:${env.SUPABASE_CLIENT_SECRET}`)
      const refreshRes    = await fetch('https://api.supabase.com/v1/oauth/token', {
        method:  'POST',
        headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
        signal:  AbortSignal.timeout(30_000),
      })
      if (refreshRes.ok) {
        const data = await refreshRes.json() as { access_token?: string; refresh_token?: string; expires_in?: number }
        if (data.access_token) {
          const encAccess   = await encrypt(data.access_token, env.ENCRYPTION_KEY)
          const encRefresh  = data.refresh_token ? await encrypt(data.refresh_token, env.ENCRYPTION_KEY) : undefined
          const expiresAt   = data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : undefined
          const patchRes = await sb(env, `user_connections?user_id=eq.${userId}&service=eq.${service}`, {
            method: 'PATCH',
            body:   JSON.stringify({
              access_token_enc: encAccess,
              ...(encRefresh ? { refresh_token_enc: encRefresh } : {}),
              ...(expiresAt  ? { expires_at: expiresAt }         : {}),
            }),
          })
          // Even if persisting the refreshed token fails, we already have a valid
          // access_token in hand for this request — return it instead of falling
          // through to the stale (expired) one below. The next call will just
          // re-refresh since the DB row still has the old expires_at.
          if (!patchRes.ok) console.error(`token persist failed: ${patchRes.status}`)
          return data.access_token
        }
      }
    } catch { /* fall through to current token */ }
  }

  return decrypt(row.access_token_enc, env.ENCRYPTION_KEY)
}

// Request-scoped memoizer: dedups getUserToken across nodes in one handler.
// Caches the Promise (not the value) so concurrent calls also share one fetch.
export function makeTokenCache(env: Env, userId: string): (service: string) => Promise<string> {
  const cache = new Map<string, Promise<string>>()
  return (service) => {
    let p = cache.get(service)
    if (!p) {
      p = getUserToken(env, userId, service)
      p.catch(() => cache.delete(service))
      cache.set(service, p)
    }
    return p
  }
}

export function auditLog(
  env: Env,
  userId: string,
  event: string,
  metadata: Record<string, unknown> = {},
  ip?: string,
): void {
  // A per-call source override (set by callTool for agent/channel dispatch)
  // wins over a handler's hardcoded metadata.source, so audit rows attribute
  // the action to the channel it actually came from (slack/whatsapp/agent).
  const overrideSource = env._auditSource
  const meta = overrideSource ? { ...metadata, source: overrideSource } : metadata
  // Channel is a queryable top-level column (E4). A per-call agent/channel
  // override (slack/whatsapp/agent/cron) is more specific than the transport-
  // derived default (web/mcp, set by the auth middleware), so it wins.
  const channel = env._auditSource ?? env._auditChannel
  sb(env, 'user_audit_log', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      user_id: userId,
      event,
      metadata: redactPayload(meta),
      ...(channel ? { channel } : {}),
      ...(ip ? { ip } : {}),
    }),
  })
    .then((res) => { if (!res.ok) console.error(`audit log write failed: ${res.status} event=${event}`) })
    .catch(() => {})
}
