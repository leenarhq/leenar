import { Hono } from 'hono'
import type { Env } from '../types'
import { onboardingEmail } from '../emails/onboarding'
import { createLogger } from '../logger'
import { scopedQuery } from '../tenancy'

const log = createLogger({ route: 'hooks' })

export const hooks = new Hono<{ Bindings: Env; Variables: { userId: string } }>()

/**
 * POST /api/hooks/onboarding
 * Called by the frontend immediately after supabase.auth.signUp() succeeds.
 * Requires a valid JWT (same auth middleware as all /api/* routes).
 * Sends the onboarding email via Resend.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

hooks.post('/onboarding', async (c) => {
  const userId = c.get('userId')
  const { name } = await c.req.json<{ name?: string }>().catch(() => ({ name: undefined }))

  // Fetch authoritative email from Supabase auth — never trust body email
  const authRes = await fetch(`${c.env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: {
      apikey:        c.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${c.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  })
  if (!authRes.ok) return c.json({ ok: false }, 200)
  const { email } = await authRes.json<{ email?: string }>()
  if (!email || !EMAIL_RE.test(email)) return c.json({ ok: false }, 200)

  // Atomic idempotency: INSERT with return=representation — if row already exists
  // (UNIQUE constraint on user_id), ignore-duplicates returns an empty array.
  // This eliminates the GET→INSERT race that could send duplicate onboarding emails.
  const claimRes = await scopedQuery(c.env, userId, 'user_onboarding_sent', {
    method: 'POST',
    headers: { Prefer: 'return=representation,resolution=ignore-duplicates' },
  })
  if (!claimRes.ok) {
    log.error('onboarding.idempotency_claim_failed', { status: claimRes.status })
    return c.json({ ok: false }, 200)
  }
  const claimRows = await claimRes.json<unknown[]>()
  if (claimRows.length === 0) {
    // Row already existed — duplicate request, skip silently
    return c.json({ ok: true, skipped: true })
  }

  const { subject, html, text } = onboardingEmail({
    name:        name || email.split('@')[0],
    email,
    frontendUrl: c.env.FRONTEND_URL,
  })

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${c.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    c.env.RESEND_FROM,
      to:      [email],
      subject,
      html,
      text,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    log.error('onboarding.email_failed', { status: res.status, body: err.slice(0, 200) })
    // Release the idempotency claim so a retry can actually send the email —
    // otherwise the claim row persists and every retry skips silently (email lost).
    await scopedQuery(c.env, userId, 'user_onboarding_sent', { method: 'DELETE' }).catch(() => {})
    return c.json({ ok: false }, 200)
  }

  const { id } = await res.json<{ id: string }>()
  log.info('onboarding.email_sent', { id })

  return c.json({ ok: true })
})
