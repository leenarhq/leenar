import { sb } from './utils'
import type { Env } from './types'
import { assertWorkflowOwner, assertEnvOwner } from './ownership'

/** Thrown by tier-2 helpers when the caller does not own the parent resource. */
export class NotOwnedError extends Error {
  constructor(public resource: string) {
    super('Not found')
    this.name = 'NotOwnedError'
  }
}

/**
 * Tier-1 tenant scoping for tables that HAVE a `user_id` column.
 * - GET/PATCH/DELETE: prepends `user_id=eq.${userId}` to the query filter.
 * - POST (insert): injects `user_id` into each row of the body instead
 *   (a query filter is meaningless for an insert).
 * Never append user_id to a table without that column — use a tier-2 helper.
 */
export function scopedQuery(
  env: Env,
  userId: string,
  table: string,
  opts: {
    query?: string
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
    body?: unknown
    headers?: Record<string, string>
  } = {},
): Promise<Response> {
  const method = opts.method ?? 'GET'
  const init: RequestInit = { method, headers: opts.headers }

  if (method === 'POST') {
    const withUser = Array.isArray(opts.body)
      ? opts.body.map((row) => ({ ...(row as object), user_id: userId }))
      : { ...(opts.body as object), user_id: userId }
    init.body = JSON.stringify(withUser)
    return sb(env, `${table}${opts.query ? `?${opts.query}` : ''}`, init)
  }

  if (opts.body !== undefined) init.body = JSON.stringify(opts.body)
  const filter = `user_id=eq.${userId}${opts.query ? `&${opts.query}` : ''}`
  return sb(env, `${table}?${filter}`, init)
}

type ScopeOpts = {
  query?: string
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
}

function childReq(
  env: Env,
  table: string,
  keyFilter: string,
  opts: ScopeOpts,
): Promise<Response> {
  const method = opts.method ?? 'GET'
  const init: RequestInit = { method, headers: opts.headers }
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body)
  const filter = `${keyFilter}${opts.query ? `&${opts.query}` : ''}`
  return sb(env, `${table}?${filter}`, init)
}

/**
 * Tier-2 tenant scoping for tables with NO `user_id` column, owned via a
 * parent `project`. Asserts project ownership first and throws
 * `NotOwnedError` before issuing the child query if the caller doesn't own it.
 */
export async function scopedByProject(
  env: Env,
  userId: string,
  projectId: string,
  table: string,
  opts: ScopeOpts = {},
): Promise<Response> {
  if (!(await assertWorkflowOwner(env, projectId, userId)))
    throw new NotOwnedError(`project:${projectId}`)
  return childReq(env, table, `project_id=eq.${projectId}`, opts)
}

/**
 * Tier-2 tenant scoping for tables with NO `user_id` column, owned via a
 * parent `project_environments` row (which is itself owned via project).
 */
export async function scopedByEnv(
  env: Env,
  userId: string,
  envId: string,
  table: string,
  opts: ScopeOpts = {},
): Promise<Response> {
  if (!(await assertEnvOwner(env, envId, userId)))
    throw new NotOwnedError(`environment:${envId}`)
  return childReq(env, table, `environment_id=eq.${envId}`, opts)
}

/**
 * Tier-2 tenant scoping for tables with NO `user_id` column, owned via a
 * parent `stacks` row (which DOES carry user_id).
 */
export async function scopedByStack(
  env: Env,
  userId: string,
  stackId: string,
  table: string,
  opts: ScopeOpts = {},
): Promise<Response> {
  const owns = await sb(
    env,
    `stacks?id=eq.${stackId}&user_id=eq.${userId}&select=id&limit=1`,
  )
  const rows = (await owns.json()) as unknown[]
  if (!rows.length) throw new NotOwnedError(`stack:${stackId}`)
  return childReq(env, table, `stack_id=eq.${stackId}`, opts)
}

/** Intentionally UN-scoped query: cron sweeps, DO internal state, system tables
 *  (waitlist/invites/security_events/…), and token/email lookups. Named so the
 *  static tenancy test can tell a reviewed-global call from a forgotten filter. */
export function systemQuery(env: Env, path: string, init?: RequestInit): Promise<Response> {
  return sb(env, path, init)
}
