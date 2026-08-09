import { redactSecretsFromText } from '../utils'

const RESEND_API = 'https://api.resend.com'

export interface ResendDomain {
  id:         string
  name:       string
  status:     'not_started' | 'pending' | 'verified' | 'temporary_failure' | 'permanent_failure'
  region:     string
  created_at: string
}

/**
 * Best-effort count of emails sent on a given UTC date (YYYY-MM-DD). Resend has no usage
 * endpoint, so we page the recent /emails list. A full page implies an undercount — the
 * caller treats the result as an estimate. Returns 0 on any error.
 */
export async function getResendDailyEmailCount(token: string, dateStr: string): Promise<number> {
  try {
    const res = await fetch(`${RESEND_API}/emails?limit=100`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) return 0
    const raw = await res.json<unknown>()
    const arr = Array.isArray(raw) ? raw : (raw as any)?.data
    if (!Array.isArray(arr)) return 0
    return arr.filter(
      (e: any) => typeof e?.created_at === 'string' && e.created_at.slice(0, 10) === dateStr,
    ).length
  } catch {
    return 0
  }
}

export async function listDomains(token: string): Promise<ResendDomain[]> {
  const res = await fetch(`${RESEND_API}/domains`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const err = await res.json<{ message?: string }>().catch(() => ({}))
    const msg = redactSecretsFromText((err as any).message ?? String(res.status), [token])
    throw new Error(`Resend list domains failed: ${msg}`)
  }
  const raw = await res.json<unknown>()
  const arr = Array.isArray(raw) ? raw : (raw as any)?.data
  return Array.isArray(arr) ? (arr as ResendDomain[]) : []
}
