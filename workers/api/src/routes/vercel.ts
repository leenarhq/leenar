import { Hono } from 'hono'
import type { Env } from '../types'
import { getUserToken } from '../utils'
import { createLogger } from '../logger'
import { addVercelDnsRecords, deleteVercelDnsRecords } from '../connectors/cloudflare'
import { getVercelDeploymentState } from '../connectors/vercel'

const log = createLogger({ route: 'vercel' })

export const vercel = new Hono<{ Bindings: Env; Variables: { userId: string } }>()

export interface VercelDomainVerification {
  type: string
  domain: string
  value: string
  reason?: string
}

export interface VercelDomain {
  name: string
  apexName: string
  verified: boolean
  verification?: VercelDomainVerification[]
  cname?: string
}

interface VercelProject {
  id: string
  name: string
  link?: { org?: string; repo?: string }
  supabaseRef?: string
}

vercel.get('/projects', async (c) => {
  const userId = c.get('userId')
  try {
    const token = await getUserToken(c.env, userId, 'vercel')
    const res = await fetch('https://api.vercel.com/v9/projects?limit=100', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const body = await res.text()
      log.error('vercel_projects_failed', { status: res.status, body: body.slice(0, 200) })
      return c.json({ error: `Upstream error (${res.status}). Please try again.` }, 502)
    }
    const data = await res.json() as { projects: VercelProject[] }
    const projects = data.projects ?? []

    // Fetch env vars per project to detect linked Supabase project refs.
    // NEXT_PUBLIC_SUPABASE_URL is plain-type so its value is returned by the API.
    const enriched = await Promise.all(
      projects.map(async (p): Promise<VercelProject> => {
        try {
          const envRes = await fetch(`https://api.vercel.com/v9/projects/${p.id}/env`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (!envRes.ok) return p
          const envData = await envRes.json() as {
            envs: Array<{ key: string; value?: string }>
          }
          // Match any framework prefix (Next/Vite/Astro) or the base name so
          // Vite/TanStack projects are detected too, not just Next.js.
          const SUPABASE_URL_KEYS = new Set([
            'SUPABASE_URL',
            'NEXT_PUBLIC_SUPABASE_URL',
            'VITE_SUPABASE_URL',
            'PUBLIC_SUPABASE_URL',
          ])
          const supabaseEnv = envData.envs?.find(
            (e) => SUPABASE_URL_KEYS.has(e.key) && e.value,
          )
          if (!supabaseEnv?.value) return p
          const match = supabaseEnv.value.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/)
          if (!match) return p
          return { ...p, supabaseRef: match[1] }
        } catch {
          return p
        }
      }),
    )

    return c.json(enriched)
  } catch (e: unknown) {
    log.error('vercel_projects_error', { error: e instanceof Error ? e.message : String(e) })
    return c.json({ error: 'Failed to fetch Vercel projects. Please try again.' }, 500)
  }
})

// GET /api/vercel/projects/:projectId/domains
vercel.get('/projects/:projectId/domains', async (c) => {
  const userId = c.get('userId')
  const projectId = encodeURIComponent(c.req.param('projectId'))
  try {
    const token = await getUserToken(c.env, userId, 'vercel')
    const res = await fetch(`https://api.vercel.com/v9/projects/${projectId}/domains`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const body = await res.text()
      log.error('vercel_domains_failed', { status: res.status, body: body.slice(0, 200) })
      return c.json({ error: `Upstream error (${res.status}). Please try again.` }, 502)
    }
    const data = await res.json() as { domains: VercelDomain[] }
    return c.json(data.domains ?? [])
  } catch (e: unknown) {
    log.error('vercel_domains_error', { error: e instanceof Error ? e.message : String(e) })
    return c.json({ error: 'Failed to fetch domains. Please try again.' }, 500)
  }
})

// POST /api/vercel/projects/:projectId/domains — add a custom domain
vercel.post('/projects/:projectId/domains', async (c) => {
  const userId = c.get('userId')
  const projectId = encodeURIComponent(c.req.param('projectId'))
  const { name } = await c.req.json<{ name: string }>()
  if (!name?.trim()) return c.json({ error: 'domain name required' }, 400)
  try {
    const token = await getUserToken(c.env, userId, 'vercel')
    const res = await fetch(`https://api.vercel.com/v10/projects/${projectId}/domains`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    })
    const data = await res.json() as VercelDomain & { error?: { message: string } }
    if (!res.ok) return c.json({ error: data.error?.message ?? `Vercel error ${res.status}` }, 502)

    // Vercel's add-domain response omits `cname`. Fetch domain details to get it
    // so the CF DNS auto-add prompt can write the correct CNAME record.
    let cname = data.cname
    if (!cname) {
      const detailRes = await fetch(
        `https://api.vercel.com/v9/projects/${projectId}/domains/${encodeURIComponent(name.trim())}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (detailRes.ok) {
        const detail = await detailRes.json() as { cname?: string }
        cname = detail.cname
      }
    }

    // Tell the frontend if the user has CF connected (so it can offer the DNS prompt)
    const cfAvailable = await getUserToken(c.env, userId, 'cloudflare').then(() => true).catch(() => false)

    return c.json({ ...data, cname, cfAvailable }, 201)
  } catch (e: unknown) {
    log.error('vercel_domain_add_error', { error: e instanceof Error ? e.message : String(e) })
    return c.json({ error: 'Failed to add domain. Please try again.' }, 500)
  }
})

// POST /api/vercel/projects/:projectId/domains/:domain/cf-dns — add CF DNS records for a domain
vercel.post('/projects/:projectId/domains/:domain/cf-dns', async (c) => {
  const userId = c.get('userId')
  const rawProjectId = c.req.param('projectId')
  // Hono already decodes path params — do NOT call decodeURIComponent again
  const domainName = c.req.param('domain')
  const { cname, verification } = await c.req.json<{
    cname?: string
    verification?: Array<{ type: string; domain: string; value: string }>
  }>().catch(() => ({ cname: undefined, verification: undefined }))
  // Vercel project IDs are prj_xxx (alphanumeric), not UUIDs — reject obviously malformed input
  if (!/^[\w-]{1,64}$/.test(rawProjectId)) return c.json({ error: 'Invalid projectId' }, 400)
  try {
    const vercelToken = await getUserToken(c.env, userId, 'vercel')
    const ownerCheck = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(rawProjectId)}`, {
      headers: { Authorization: `Bearer ${vercelToken}` },
    })
    if (ownerCheck.status === 404) return c.json({ error: 'Project not found' }, 404)
    if (!ownerCheck.ok) return c.json({ error: 'Could not verify project ownership' }, 502)
    const cfToken = await getUserToken(c.env, userId, 'cloudflare')
    const result = await addVercelDnsRecords(cfToken, domainName, cname, verification ?? [])
    log.info('vercel_domain_cf_dns', { domain: domainName, ...result })
    return c.json(result)
  } catch (e: unknown) {
    log.error('vercel_domain_cf_dns_error', { error: e instanceof Error ? e.message : String(e) })
    return c.json({ error: 'Failed to add Cloudflare DNS records. Check your CF token permissions.' }, 500)
  }
})

// GET /api/vercel/deployments/:deploymentId/build-logs
vercel.get('/deployments/:deploymentId/build-logs', async (c) => {
  const userId = c.get('userId')
  const deploymentId = c.req.param('deploymentId')
  try {
    const token = await getUserToken(c.env, userId, 'vercel')
    const res = await fetch(
      `https://api.vercel.com/v3/deployments/${encodeURIComponent(deploymentId)}/events`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
    )
    if (!res.ok) {
      if (res.status === 404) return c.json({ logs: [] })
      const body = await res.text()
      log.error('vercel_build_logs_failed', { status: res.status, body: body.slice(0, 200) })
      return c.json({ error: `Upstream error (${res.status})` }, 502)
    }

    const raw = await res.text()
    type RawEvent = { type?: string; created?: number; date?: number; text?: string }
    let events: RawEvent[] = []
    try {
      const parsed = JSON.parse(raw)
      events = Array.isArray(parsed) ? parsed : (parsed?.events ?? [])
    } catch {
      events = raw.split('\n').filter(Boolean).flatMap((line) => {
        try { return [JSON.parse(line) as RawEvent] } catch { return [] }
      })
    }

    const logs = events
      .map((e) => ({ text: e.text ?? '', date: e.date ?? e.created ?? 0, type: e.type ?? 'stdout' }))
      .filter((e) => e.text.trim())

    return c.json({ logs })
  } catch (e: unknown) {
    log.error('vercel_build_logs_error', { error: e instanceof Error ? e.message : String(e) })
    return c.json({ error: 'Failed to fetch build logs.' }, 500)
  }
})

// GET /api/vercel/deployments/:deploymentId/state — live Vercel build readyState
vercel.get('/deployments/:deploymentId/state', async (c) => {
  const userId = c.get('userId')
  const deploymentId = c.req.param('deploymentId')
  try {
    const token = await getUserToken(c.env, userId, 'vercel')
    const { readyState, url } = await getVercelDeploymentState(token, deploymentId)
    return c.json({ readyState, url })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    log.error('vercel_deployment_state_error', { error: msg })
    // Upstream Vercel failure vs. local (token/connection) failure
    const status = msg.includes('Vercel deployment state failed') ? 502 : 500
    return c.json({ error: 'Failed to fetch deployment status.' }, status)
  }
})

// DELETE /api/vercel/projects/:projectId/domains/:domain — remove a domain
vercel.delete('/projects/:projectId/domains/:domain', async (c) => {
  const userId = c.get('userId')
  const projectId = encodeURIComponent(c.req.param('projectId'))
  const domainName = c.req.param('domain') // Hono already decodes — no decodeURIComponent
  try {
    const token = await getUserToken(c.env, userId, 'vercel')
    const res = await fetch(
      `https://api.vercel.com/v9/projects/${projectId}/domains/${encodeURIComponent(domainName)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) {
      const body = await res.text()
      log.error('vercel_domain_delete_failed', { status: res.status, body: body.slice(0, 200) })
      return c.json({ error: `Upstream error (${res.status}). Please try again.` }, 502)
    }

    // Best-effort: remove matching CF DNS records if user has CF connected
    const cfResult = await getUserToken(c.env, userId, 'cloudflare')
      .then((cfToken) => deleteVercelDnsRecords(cfToken, domainName))
      .catch(() => ({ deleted: [] }))

    log.info('vercel_domain_deleted', { domain: domainName, cfDeleted: cfResult.deleted })
    return c.json({ ok: true, cfDeleted: cfResult.deleted })
  } catch (e: unknown) {
    log.error('vercel_domain_delete_error', { error: e instanceof Error ? e.message : String(e) })
    return c.json({ error: 'Failed to remove domain. Please try again.' }, 500)
  }
})
