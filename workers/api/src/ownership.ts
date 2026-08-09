import { sb } from './utils'
import type { Env } from './types'

// Leaf module: ownership assertions with NO dependents in this file's own
// import graph other than `./utils` and `./types`. Both `tenancy.ts` and
// `routes/environments.ts` import from here — do NOT import from either of
// those (or anything that transitively imports them) to keep this a leaf
// and avoid recreating the circular-import risk this module was extracted
// to eliminate.

export async function assertWorkflowOwner(
  env: Env,
  projectId: string,
  userId: string,
): Promise<boolean> {
  const res = await sb(
    env,
    `projects?id=eq.${projectId}&user_id=eq.${userId}&select=id&limit=1`,
  )
  const rows = (await res.json()) as unknown[]
  return rows.length > 0
}

export async function assertEnvOwner(
  env: Env,
  environmentId: string,
  userId: string,
): Promise<{
  id: string
  project_id: string
  name: string
  slug: string
  is_default: boolean
  display_order: number
} | null> {
  const res = await sb(
    env,
    `project_environments?id=eq.${environmentId}&select=id,project_id,name,slug,is_default,display_order`,
  )
  const rows = (await res.json()) as Array<{
    id: string
    project_id: string
    name: string
    slug: string
    is_default: boolean
    display_order: number
  }>
  if (!rows.length) return null

  const owns = await assertWorkflowOwner(env, rows[0].project_id, userId)
  return owns ? rows[0] : null
}
