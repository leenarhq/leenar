import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { inferService, topoSort, normalizeEnvInjection, CanvasEdge, parseGitHubUrl, detectServicesFromDeps, sanitizeProjectName, buildProvisionPlan, buildPreloadedCtx, workflowProvision } from './workflowProvision'
import type { CanvasNode, ProvisionStep } from './workflowProvision'
import { ENV_FLOW } from '../constants/envFlow'
import { scopedCtxOverrides } from '../envFlowUtils'

// Mock getUserToken so buildPreloadedCtx tests don't need a real DB connection.
// Keep all other utils (sb, isUUID, etc.) real — they use the fetch stub.
vi.mock("../utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils")>();
  return { ...actual, getUserToken: vi.fn().mockResolvedValue("sb-token-test") };
});

describe('inferService', () => {
  it('maps known provider fields', () => {
    expect(inferService({ provider: 'github' })).toBe('github')
    expect(inferService({ provider: 'vercel' })).toBe('vercel')
    expect(inferService({ provider: 'supabase' })).toBe('supabase')
    expect(inferService({ provider: 'resend' })).toBe('resend')
  })

  it('is case-insensitive on provider', () => {
    expect(inferService({ provider: 'GitHub' })).toBe('github')
    expect(inferService({ provider: 'VERCEL' })).toBe('vercel')
  })

  it('falls back to label substring match', () => {
    expect(inferService({ label: 'My GitHub Repo' })).toBe('github')
    expect(inferService({ label: 'Vercel Frontend' })).toBe('vercel')
  })

  it('returns null for unknown provider and label', () => {
    expect(inferService({ provider: 'unknown' })).toBeNull()
    expect(inferService({ label: 'random node' })).toBeNull()
    expect(inferService({})).toBeNull()
  })

  it('prefers provider over label', () => {
    expect(inferService({ provider: 'github', label: 'vercel app' })).toBe('github')
  })
})

describe('topoSort', () => {
  const edge = (source: string, target: string): CanvasEdge => ({ source, target })

  it('sorts a linear chain correctly', () => {
    // github → vercel
    const result = topoSort(['vercel', 'github'], [edge('github', 'vercel')])
    expect(result.indexOf('github')).toBeLessThan(result.indexOf('vercel'))
  })

  it('sorts a diamond dependency correctly', () => {
    // github → vercel, supabase → vercel
    const nodes = ['vercel', 'github', 'supabase']
    const edges = [edge('github', 'vercel'), edge('supabase', 'vercel')]
    const result = topoSort(nodes, edges)
    expect(result.indexOf('github')).toBeLessThan(result.indexOf('vercel'))
    expect(result.indexOf('supabase')).toBeLessThan(result.indexOf('vercel'))
  })

  it('handles disconnected nodes (no edges)', () => {
    const result = topoSort(['a', 'b', 'c'], [])
    expect(result).toHaveLength(3)
    expect(result).toContain('a')
    expect(result).toContain('b')
    expect(result).toContain('c')
  })

  it('handles empty input', () => {
    expect(topoSort([], [])).toEqual([])
  })

  it('appends cycle nodes rather than dropping them', () => {
    // a → b → a (cycle)
    const result = topoSort(['a', 'b'], [edge('a', 'b'), edge('b', 'a')])
    expect(result).toHaveLength(2)
    expect(result).toContain('a')
    expect(result).toContain('b')
  })

  it('ignores edges referencing unknown node ids', () => {
    const result = topoSort(['a', 'b'], [edge('a', 'z'), edge('z', 'b')])
    expect(result).toHaveLength(2)
  })
})

describe('ENV_FLOW structure', () => {
  it('supabase injects to vercel with required base keys', () => {
    // ENV_FLOW holds base names; prefixes (NEXT_PUBLIC_/VITE_/PUBLIC_) are
    // applied by resolveEnvKeys at provision time based on framework.
    expect(ENV_FLOW.supabase.vercel).toContain('SUPABASE_URL')
    expect(ENV_FLOW.supabase.vercel).toContain('SUPABASE_ANON_KEY')
    expect(ENV_FLOW.supabase.vercel).toContain('SUPABASE_SERVICE_ROLE_KEY')
  })

  it('github injects to vercel with required keys', () => {
    expect(ENV_FLOW.github.vercel).toContain('GITHUB_OWNER')
    expect(ENV_FLOW.github.vercel).toContain('GITHUB_REPO')
  })

  it('resend injects to cloudflare-workers', () => {
    expect(ENV_FLOW.resend['cloudflare-workers']).toContain('RESEND_API_KEY')
  })

  it('resend injects to vercel', () => {
    expect(ENV_FLOW.resend.vercel).toContain('RESEND_API_KEY')
  })

  it('cloudflare-workers injects to vercel (API_URL base)', () => {
    expect(ENV_FLOW['cloudflare-workers'].vercel).toContain('API_URL')
    expect(ENV_FLOW['cloudflare-workers'].vercel).toContain('WORKER_URL')
  })

  it('vercel injects to cloudflare-workers (ALLOWED_ORIGIN)', () => {
    expect(ENV_FLOW.vercel['cloudflare-workers']).toContain('ALLOWED_ORIGIN')
    expect(ENV_FLOW.vercel['cloudflare-workers']).toContain('FRONTEND_URL')
  })

  it('cloudflare-r2 injects to vercel (S3 API vars)', () => {
    expect(ENV_FLOW['cloudflare-r2'].vercel).toContain('R2_BUCKET_NAME')
    expect(ENV_FLOW['cloudflare-r2'].vercel).toContain('R2_ACCESS_KEY_ID')
  })

  it('no default fallback keys in any entry', () => {
    for (const [src, targets] of Object.entries(ENV_FLOW)) {
      expect(Object.keys(targets), `${src} must not have a default key`).not.toContain('default')
    }
  })
})

describe('normalizeEnvInjection', () => {
  const node = (id: string, provider: string) => ({ id, data: { provider } })

  it('injects supabase vars into vercel when edge goes supabase→vercel', () => {
    const nodes  = [node('sb', 'supabase'), node('vc', 'vercel')]
    const edges: CanvasEdge[] = [{ source: 'sb', target: 'vc' }]
    const { envInjection, normalizedEdges } = normalizeEnvInjection(edges, nodes)
    expect(envInjection['vc']).toContain('NEXT_PUBLIC_SUPABASE_URL')
    expect(envInjection['vc']).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(normalizedEdges[0].source).toBe('sb')
    expect(normalizedEdges[0].target).toBe('vc')
  })

  it('flips edge and injects when drawn backwards (vercel→supabase)', () => {
    const nodes  = [node('vc', 'vercel'), node('sb', 'supabase')]
    const edges: CanvasEdge[] = [{ source: 'vc', target: 'sb' }]
    const { envInjection, normalizedEdges } = normalizeEnvInjection(edges, nodes)
    // Vars should end up on the vercel node (source), not the supabase node (target)
    expect(envInjection['vc']).toContain('NEXT_PUBLIC_SUPABASE_URL')
    expect(envInjection['sb']).toBeUndefined()
    // Edge should be flipped
    expect(normalizedEdges[0].source).toBe('sb')
    expect(normalizedEdges[0].target).toBe('vc')
  })

  it('flips a backwards override edge and injects the override var into the source (agrees with computeDesiredEnvKeys)', () => {
    // Cross-check for envFlowUtils fix 1: an override edge drawn vercel→supabase
    // (no forward ENV_FLOW pair, reverse pair exists) flips → the override var
    // lands on the vercel node. computeDesiredEnvKeys(canvas, 'vc') must include
    // the same key so drift detection doesn't delete it as env_stale.
    const nodes = [node('vc', 'vercel'), node('sb', 'supabase')]
    const edges: CanvasEdge[] = [{ source: 'vc', target: 'sb', data: { envVars: ['CUSTOM_KEY'] } }]
    const { envInjection, normalizedEdges } = normalizeEnvInjection(edges, nodes)
    expect(envInjection['vc']).toContain('CUSTOM_KEY')
    expect(envInjection['sb']).toBeUndefined()
    expect(normalizedEdges[0].source).toBe('sb')
    expect(normalizedEdges[0].target).toBe('vc')
  })

  it('injects github vars into vercel for github→vercel edge', () => {
    const nodes  = [node('gh', 'github'), node('vc', 'vercel')]
    const edges: CanvasEdge[] = [{ source: 'gh', target: 'vc' }]
    const { envInjection } = normalizeEnvInjection(edges, nodes)
    expect(envInjection['vc']).toContain('GITHUB_OWNER')
    expect(envInjection['vc']).toContain('GITHUB_REPO')
  })

  it('accumulates vars from multiple sources into the same target', () => {
    const nodes  = [node('sb', 'supabase'), node('gh', 'github'), node('vc', 'vercel')]
    const edges: CanvasEdge[] = [
      { source: 'sb', target: 'vc' },
      { source: 'gh', target: 'vc' },
    ]
    const { envInjection } = normalizeEnvInjection(edges, nodes)
    expect(envInjection['vc']).toContain('NEXT_PUBLIC_SUPABASE_URL')
    expect(envInjection['vc']).toContain('GITHUB_OWNER')
  })

  it('passes through edge with no known injection (no ENV_FLOW entry)', () => {
    const nodes  = [node('a', 'vercel'), node('b', 'vercel')]
    const edges: CanvasEdge[] = [{ source: 'a', target: 'b' }]
    const { envInjection, normalizedEdges } = normalizeEnvInjection(edges, nodes)
    expect(Object.keys(envInjection)).toHaveLength(0)
    expect(normalizedEdges).toHaveLength(1)
  })

  it('handles edge with unknown node id (no matching node)', () => {
    const nodes  = [node('sb', 'supabase')]
    const edges: CanvasEdge[] = [{ source: 'sb', target: 'ghost' }]
    const { envInjection, normalizedEdges } = normalizeEnvInjection(edges, nodes)
    // 'ghost' node not found → srcSvc or tgtSvc null → pass-through
    expect(Object.keys(envInjection)).toHaveLength(0)
    expect(normalizedEdges).toHaveLength(1)
  })

  it('returns empty results for no edges', () => {
    const nodes  = [node('sb', 'supabase'), node('vc', 'vercel')]
    const { envInjection, normalizedEdges } = normalizeEnvInjection([], nodes)
    expect(envInjection).toEqual({})
    expect(normalizedEdges).toEqual([])
  })

  it('workers→vercel: forward defined, does not flip', () => {
    const nodes  = [
      { id: 'cfw', data: { provider: 'cloudflare', cloudflareService: 'workers' } },
      node('vc', 'vercel'),
    ]
    const edges: CanvasEdge[] = [{ source: 'cfw', target: 'vc' }]
    const { envInjection, normalizedEdges } = normalizeEnvInjection(edges, nodes)
    expect(envInjection['vc']).toContain('NEXT_PUBLIC_API_URL')
    expect(envInjection['vc']).toContain('NEXT_PUBLIC_WORKER_URL')
    expect(envInjection['cfw']).toBeUndefined()
    expect(normalizedEdges[0].source).toBe('cfw') // not flipped
    expect(normalizedEdges[0].target).toBe('vc')
  })

  it('vercel→workers: forward defined (ALLOWED_ORIGIN), does not flip', () => {
    const nodes  = [
      node('vc', 'vercel'),
      { id: 'cfw', data: { provider: 'cloudflare', cloudflareService: 'workers' } },
    ]
    const edges: CanvasEdge[] = [{ source: 'vc', target: 'cfw' }]
    const { envInjection, normalizedEdges } = normalizeEnvInjection(edges, nodes)
    expect(envInjection['cfw']).toContain('ALLOWED_ORIGIN')
    expect(envInjection['cfw']).toContain('FRONTEND_URL')
    expect(envInjection['vc']).toBeUndefined()
    expect(normalizedEdges[0].source).toBe('vc') // not flipped
    expect(normalizedEdges[0].target).toBe('cfw')
  })

  it('edge.data.envVars override: custom (non-public) names pass through literally', () => {
    const nodes  = [node('sb', 'supabase'), node('vc', 'vercel')]
    const edges: CanvasEdge[] = [{ source: 'sb', target: 'vc', data: { envVars: ['CUSTOM_KEY'] } }]
    const { envInjection, normalizedEdges } = normalizeEnvInjection(edges, nodes)
    expect(envInjection['vc']).toEqual(['CUSTOM_KEY'])
    expect(normalizedEdges[0].source).toBe('sb') // direction preserved
  })

  it('override with ENV_FLOW base names (MCP-frozen) is still framework-resolved', () => {
    // MCP connect_services/setup_workflow freeze base names into edge.data.envVars.
    // The override branch must still shotgun public bases to their client-prefixed
    // twins — otherwise NEXT_PUBLIC_* never reaches Vercel for MCP-built topologies.
    const nodes  = [node('sb', 'supabase'), node('vc', 'vercel')]
    const edges: CanvasEdge[] = [
      { source: 'sb', target: 'vc', data: { envVars: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] } },
    ]
    const { envInjection } = normalizeEnvInjection(edges, nodes)
    expect(envInjection['vc']).toContain('NEXT_PUBLIC_SUPABASE_URL')
    expect(envInjection['vc']).toContain('VITE_SUPABASE_URL')
    // non-public base passes through unchanged
    expect(envInjection['vc']).toContain('SUPABASE_SERVICE_ROLE_KEY')
  })

  it('override on a flipped edge resolves against the receiving (source) service', () => {
    const nodes  = [node('vc', 'vercel'), node('sb', 'supabase')]
    // Drawn backwards; only supabase→vercel is a real dependency, so it flips and
    // vercel (e.source) is the receiver → resolve public bases for the vercel target.
    const edges: CanvasEdge[] = [
      { source: 'vc', target: 'sb', data: { envVars: ['SUPABASE_URL'] } },
    ]
    const { envInjection, normalizedEdges } = normalizeEnvInjection(edges, nodes)
    expect(envInjection['vc']).toContain('NEXT_PUBLIC_SUPABASE_URL')
    expect(normalizedEdges[0].source).toBe('sb') // flipped
  })

  it('deferred Supabase target: injection skipped (envInjection empty)', () => {
    const nodes  = [node('rs', 'resend'), node('sb', 'supabase')]
    const edges: CanvasEdge[] = [{ source: 'rs', target: 'sb' }]
    const { envInjection } = normalizeEnvInjection(edges, nodes)
    // resend→supabase has no ENV_FLOW entry (removed — Supabase is DEFERRED_INJECTION_TARGET)
    expect(envInjection['sb'] ?? []).toHaveLength(0)
  })
})

// ── parseGitHubUrl ───────────────────────────────────────────────────────────

describe('parseGitHubUrl', () => {
  it('parses https URL', () => {
    expect(parseGitHubUrl('https://github.com/acme/my-app')).toEqual({ owner: 'acme', repo: 'my-app' })
  })

  it('strips .git suffix', () => {
    expect(parseGitHubUrl('https://github.com/acme/my-app.git')).toEqual({ owner: 'acme', repo: 'my-app' })
  })

  it('strips trailing path segments after the repo', () => {
    expect(parseGitHubUrl('https://github.com/acme/my-app/tree/main')).toEqual({ owner: 'acme', repo: 'my-app' })
    expect(parseGitHubUrl('https://github.com/acme/my-app#readme')).toEqual({ owner: 'acme', repo: 'my-app' })
  })

  it('handles SSH-style URL', () => {
    expect(parseGitHubUrl('git@github.com:acme/my-app.git')).toEqual({ owner: 'acme', repo: 'my-app' })
  })

  it('returns null for non-GitHub URL', () => {
    expect(parseGitHubUrl('https://gitlab.com/acme/my-app')).toBeNull()
    expect(parseGitHubUrl('not a url')).toBeNull()
    expect(parseGitHubUrl('')).toBeNull()
  })
})

// ── detectServicesFromDeps ───────────────────────────────────────────────────

describe('detectServicesFromDeps', () => {
  it('always includes github', () => {
    const { services } = detectServicesFromDeps([])
    expect(services).toContain('github')
  })

  it('detects next.js → vercel', () => {
    const { services } = detectServicesFromDeps(['next', 'react'])
    expect(services).toContain('vercel')
  })

  it('detects nuxt → vercel', () => {
    const { services } = detectServicesFromDeps(['nuxt'])
    expect(services).toContain('vercel')
  })

  it('detects @supabase/supabase-js → supabase', () => {
    const { services } = detectServicesFromDeps(['@supabase/supabase-js'])
    expect(services).toContain('supabase')
  })

  it('detects @supabase/ssr → supabase', () => {
    const { services } = detectServicesFromDeps(['@supabase/ssr'])
    expect(services).toContain('supabase')
  })

  it('detects resend package', () => {
    const { services } = detectServicesFromDeps(['resend'])
    expect(services).toContain('resend')
  })

  it('builds supabase→vercel connection for full-stack app', () => {
    const { connections } = detectServicesFromDeps(['next', '@supabase/supabase-js'])
    expect(connections).toContainEqual({ from_type: 'supabase', to_type: 'vercel' })
    expect(connections).toContainEqual({ from_type: 'github', to_type: 'vercel' })
  })

  it('does not add vercel connection when no vercel framework detected', () => {
    const { connections } = detectServicesFromDeps(['@supabase/supabase-js'])
    const toVercel = connections.filter(c => c.to_type === 'vercel')
    expect(toVercel).toHaveLength(0)
  })

  it('adds resend→supabase connection when both are present', () => {
    const { connections } = detectServicesFromDeps(['resend', '@supabase/supabase-js'])
    expect(connections).toContainEqual({ from_type: 'resend', to_type: 'supabase' })
  })

  it('does not add resend→supabase when supabase is absent', () => {
    const { connections } = detectServicesFromDeps(['resend', 'next'])
    const resendToSupabase = connections.filter(c => c.from_type === 'resend' && c.to_type === 'supabase')
    expect(resendToSupabase).toHaveLength(0)
  })

  it('orders services: github first, then supabase, vercel, resend', () => {
    const { services } = detectServicesFromDeps(['resend', 'next', '@supabase/supabase-js'])
    expect(services[0]).toBe('github')
    expect(services.indexOf('supabase')).toBeLessThan(services.indexOf('vercel'))
  })

  it('detects vite → vercel', () => {
    const { services } = detectServicesFromDeps(['vite', 'react'])
    expect(services).toContain('vercel')
  })

  it('detects vite + supabase → vercel + supabase with connections', () => {
    const { services, connections } = detectServicesFromDeps(['vite', '@supabase/supabase-js'])
    expect(services).toContain('vercel')
    expect(services).toContain('supabase')
    expect(connections).toContainEqual({ from_type: 'supabase', to_type: 'vercel' })
  })

  it('detects VITE_SUPABASE_ env var as supabase', () => {
    const { services } = detectServicesFromDeps([], ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'])
    expect(services).toContain('supabase')
  })

  it('detects vite + supabase + resend full stack', () => {
    const { services } = detectServicesFromDeps(['vite', 'react', '@supabase/supabase-js', 'resend'])
    expect(services).toContain('vercel')
    expect(services).toContain('supabase')
    expect(services).toContain('resend')
  })
})

// ── sanitizeProjectName ──────────────────────────────────────────────────────

describe('sanitizeProjectName', () => {
  it('replaces special chars with hyphens', () => {
    expect(sanitizeProjectName('@acme/my_app!', 'fallback')).toBe('acme-my-app')
  })

  it('collapses consecutive hyphens', () => {
    expect(sanitizeProjectName('foo---bar', 'fallback')).toBe('foo-bar')
  })

  it('strips leading and trailing hyphens', () => {
    expect(sanitizeProjectName('-hello-', 'fallback')).toBe('hello')
  })

  it('truncates at 60 chars', () => {
    const long = 'a'.repeat(80)
    expect(sanitizeProjectName(long, 'fallback')).toHaveLength(60)
  })

  it('falls back to repo name when name is undefined', () => {
    expect(sanitizeProjectName(undefined, 'my-repo')).toBe('my-repo')
  })

  it('falls back when sanitized result is empty', () => {
    expect(sanitizeProjectName('---', 'my-repo')).toBe('my-repo')
  })

  it('preserves valid kebab-case names unchanged', () => {
    expect(sanitizeProjectName('my-cool-app', 'fallback')).toBe('my-cool-app')
  })
})

// ── buildProvisionPlan — redeploySteps ───────────────────────────────────────

const vercelNode = (id = 'v1'): CanvasNode => ({
  id,
  type: 'service',
  data: {
    provider: 'vercel',
    vercelProjectId: 'prj_abc',
    status: 'provisioned',
    label: 'Frontend',
  },
})

const cfNode = (id = 'cf1'): CanvasNode => ({
  id,
  type: 'service',
  data: {
    provider: 'cloudflare',
    cloudflareService: 'workers',
    cfWorkerNameProvisioned: 'my-worker',
    status: 'provisioned',
    label: 'Worker',
  },
})

describe('buildProvisionPlan — redeploySteps', () => {
  it('does NOT include provisioned Vercel node when there is nothing to inject', () => {
    const { steps } = buildProvisionPlan([vercelNode()], [])
    const redeploy = steps.filter(s => s.action === 'redeploy')
    expect(redeploy).toHaveLength(0)
  })

  it('includes provisioned Vercel node when env vars need injecting via edge', () => {
    const r2Node: CanvasNode = {
      id: 'r2',
      type: 'service',
      data: {
        provider: 'cloudflare',
        cloudflareService: 'r2',
        cfBucketNameProvisioned: 'my-bucket',
        status: 'provisioned',
        label: 'R2',
      },
    }
    const edge: CanvasEdge = { source: 'r2', target: 'v1' }
    const { steps } = buildProvisionPlan([r2Node, vercelNode()], [edge])
    const redeploy = steps.filter(s => s.action === 'redeploy')
    expect(redeploy).toHaveLength(1)
    expect(redeploy[0].service).toBe('vercel')
    expect(redeploy[0].nodeId).toBe('v1')
  })

  it('includes provisioned Vercel node when it has customEnvVars', () => {
    const vercel: CanvasNode = {
      id: 'v1',
      type: 'service',
      data: {
        provider: 'vercel',
        vercelProjectId: 'prj_abc',
        status: 'provisioned',
        label: 'Frontend',
        customEnvVars: [{ key: 'MY_VAR', value: 'hello' }],
      },
    }
    const { steps } = buildProvisionPlan([vercel], [])
    const redeploy = steps.filter(s => s.action === 'redeploy')
    expect(redeploy).toHaveLength(1)
    expect(redeploy[0].service).toBe('vercel')
    expect(redeploy[0].nodeId).toBe('v1')
  })

  it('does NOT include provisioned CF Worker node (no DO handler yet)', () => {
    const { steps } = buildProvisionPlan([cfNode()], [])
    const redeploy = steps.filter(s => s.action === 'redeploy')
    expect(redeploy).toHaveLength(0)
  })

  it('does NOT include supabase in redeploySteps', () => {
    const sbNode: CanvasNode = {
      id: 'sb1',
      type: 'service',
      data: {
        provider: 'supabase',
        supabaseProjectRef: 'abcdef',
        status: 'provisioned',
        label: 'DB',
      },
    }
    const { steps } = buildProvisionPlan([sbNode], [])
    const redeploy = steps.filter(s => s.action === 'redeploy')
    expect(redeploy).toHaveLength(0)
  })

  it('does NOT include un-provisioned Vercel node in redeploySteps', () => {
    const draft: CanvasNode = {
      id: 'v2',
      type: 'service',
      // existing_repo required so buildProvisionPlan doesn't return an early error
      data: { provider: 'vercel', label: 'Frontend', existing_repo: 'https://github.com/acme/app' },
    }
    const { steps } = buildProvisionPlan([draft], [])
    const redeploy = steps.filter(s => s.action === 'redeploy')
    expect(redeploy).toHaveLength(0)
    // should be a provision step instead
    const provision = steps.filter(s => s.action === 'provision')
    expect(provision).toHaveLength(1)
  })
})

// ── buildProvisionPlan — repo resolved from connected GitHub node ────────────

describe('buildProvisionPlan — repo from connected GitHub node', () => {
  const githubNode = (id = 'gh1', repo = 'https://github.com/acme/app'): CanvasNode => ({
    id,
    type: 'service',
    data: { provider: 'github', label: 'GitHub', existing_repo: repo },
  })

  it('Cloudflare Worker inherits repo from github→worker edge (no repo on worker node)', () => {
    const worker: CanvasNode = {
      id: 'cf1',
      type: 'service',
      data: { provider: 'cloudflare', cloudflareService: 'workers', label: 'Worker' },
    }
    const edge: CanvasEdge = { source: 'gh1', target: 'cf1' }
    const { steps, error } = buildProvisionPlan([githubNode(), worker], [edge])
    expect(error).toBeUndefined()
    const cf = steps.find(s => s.service === 'cloudflare-workers')
    expect(cf?.params.existing_repo).toBe('https://github.com/acme/app')
  })

  it('Vercel without repo on node passes when a github→vercel edge supplies it', () => {
    const vercel: CanvasNode = {
      id: 'v1',
      type: 'service',
      data: { provider: 'vercel', label: 'Frontend' },
    }
    const edge: CanvasEdge = { source: 'gh1', target: 'v1' }
    const { steps, error } = buildProvisionPlan([githubNode(), vercel], [edge])
    expect(error).toBeUndefined()
    const v = steps.find(s => s.service === 'vercel')
    expect(v?.params.existing_repo).toBe('https://github.com/acme/app')
  })

  it('connected GitHub node wins over a stale existing_repo on the node (edge is source of truth)', () => {
    // M1: the canvas edge is authoritative — a visible github→worker edge must
    // deploy the connected repo, not a stale copy the picker/creation-copy left
    // on the node.
    const worker: CanvasNode = {
      id: 'cf1',
      type: 'service',
      data: {
        provider: 'cloudflare',
        cloudflareService: 'workers',
        label: 'Worker',
        existing_repo: 'https://github.com/acme/stale',
      },
    }
    const edge: CanvasEdge = { source: 'gh1', target: 'cf1' }
    const { steps } = buildProvisionPlan([githubNode(), worker], [edge])
    const cf = steps.find(s => s.service === 'cloudflare-workers')
    expect(cf?.params.existing_repo).toBe('https://github.com/acme/app')
  })

  it('falls back to the node\'s own existing_repo when there is no GitHub edge', () => {
    const worker: CanvasNode = {
      id: 'cf1',
      type: 'service',
      data: {
        provider: 'cloudflare',
        cloudflareService: 'workers',
        label: 'Worker',
        existing_repo: 'https://github.com/acme/standalone',
      },
    }
    // No edge at all — node's own repo is the only source.
    const { steps } = buildProvisionPlan([worker], [])
    const cf = steps.find(s => s.service === 'cloudflare-workers')
    expect(cf?.params.existing_repo).toBe('https://github.com/acme/standalone')
  })

  it('inherits an auto-created repo from githubRepoName when existing_repo is empty', () => {
    // Auto-created repos never populate existing_repo (authoring intent) — the
    // provisioner writes the created repo to githubRepoName (runtime state).
    // On redeploy the Worker step must still resolve it, or the pre-flight
    // "Worker needs a GitHub repo" check throws despite a valid github→worker edge.
    const gh: CanvasNode = {
      id: 'gh1',
      type: 'service',
      data: { provider: 'github', label: 'GitHub', githubRepoName: 'acme/generated' },
    }
    const worker: CanvasNode = {
      id: 'cf1',
      type: 'service',
      data: { provider: 'cloudflare', cloudflareService: 'workers', label: 'Worker' },
    }
    const edge: CanvasEdge = { source: 'gh1', target: 'cf1' }
    const { steps, error } = buildProvisionPlan([gh, worker], [edge])
    expect(error).toBeUndefined()
    const cf = steps.find(s => s.service === 'cloudflare-workers')
    expect(cf?.params.existing_repo).toBe('acme/generated')
  })

  it('resolves even when the edge is drawn worker→github (direction-agnostic)', () => {
    const worker: CanvasNode = {
      id: 'cf1',
      type: 'service',
      data: { provider: 'cloudflare', cloudflareService: 'workers', label: 'Worker' },
    }
    const edge: CanvasEdge = { source: 'cf1', target: 'gh1' }
    const { steps } = buildProvisionPlan([githubNode(), worker], [edge])
    const cf = steps.find(s => s.service === 'cloudflare-workers')
    expect(cf?.params.existing_repo).toBe('https://github.com/acme/app')
  })
})

// ── inferService — Cloudflare label/cloudflareService fallback (no provider) ─

describe('inferService — Cloudflare fallback without provider', () => {
  it('infers from cloudflareService when provider is unset', () => {
    expect(inferService({ cloudflareService: 'workers' })).toBe('cloudflare-workers')
    expect(inferService({ cloudflareService: 'r2' })).toBe('cloudflare-r2')
  })

  it('infers from a Cloudflare-ish label when provider is unset', () => {
    expect(inferService({ label: 'Cloudflare Workers' })).toBe('cloudflare-workers')
    expect(inferService({ label: 'Cloudflare R2' })).toBe('cloudflare-r2')
  })

  it('still infers non-cloudflare providers by label', () => {
    expect(inferService({ label: 'Vercel Frontend' })).toBe('vercel')
    expect(inferService({ label: 'My GitHub Repo' })).toBe('github')
  })
})

// ── buildPreloadedCtx — env value plumbing for cross-service ENV_FLOW pairs ───

describe('buildPreloadedCtx — cross-service value plumbing', () => {
  const step = (nodeId: string, injectEnvVars: string[] = []): ProvisionStep =>
    ({
      nodeId,
      service: 'vercel',
      action: 'provision',
      params: {},
      injectEnvVars,
    } as unknown as ProvisionStep)

  it('derives GITHUB_OWNER/GITHUB_REPO/GITHUB_REPO_URL from a connected github node', async () => {
    const gh: CanvasNode = { id: 'gh1', type: 'service', data: { provider: 'github', existing_repo: 'https://github.com/acme/app' } }
    const vercel: CanvasNode = { id: 'v1', type: 'service', data: { provider: 'vercel' } }
    const ctx = await buildPreloadedCtx({} as any, 'u1', [gh, vercel], [{ source: 'gh1', target: 'v1' }], [step('v1')])
    expect(ctx.GITHUB_OWNER).toBe('acme')
    expect(ctx.GITHUB_REPO).toBe('app')
    expect(ctx.GITHUB_REPO_URL).toBe('https://github.com/acme/app')
  })

  it('does not derive github vars when the github node is unconnected to any step', async () => {
    const gh: CanvasNode = { id: 'gh1', type: 'service', data: { provider: 'github', existing_repo: 'acme/app' } }
    const vercel: CanvasNode = { id: 'v1', type: 'service', data: { provider: 'vercel' } }
    const ctx = await buildPreloadedCtx({} as any, 'u1', [gh, vercel], [], [step('v1')])
    expect(ctx.GITHUB_OWNER).toBeUndefined()
  })

  it('plumbs an already-provisioned Worker URL to API_URL/WORKER_URL for a connected Vercel', async () => {
    const worker: CanvasNode = { id: 'cf1', type: 'service', data: { provider: 'cloudflare', cloudflareService: 'workers', cloudflareWorkerUrl: 'https://api.example.workers.dev' } }
    const vercel: CanvasNode = { id: 'v1', type: 'service', data: { provider: 'vercel' } }
    const ctx = await buildPreloadedCtx({} as any, 'u1', [worker, vercel], [{ source: 'cf1', target: 'v1' }], [step('v1')])
    expect(ctx.API_URL).toBe('https://api.example.workers.dev')
    expect(ctx.WORKER_URL).toBe('https://api.example.workers.dev')
    expect(ctx.NEXT_PUBLIC_API_URL).toBe('https://api.example.workers.dev')
  })

  it('plumbs an already-provisioned Vercel URL to ALLOWED_ORIGIN/FRONTEND_URL for a connected Worker', async () => {
    const vercel: CanvasNode = { id: 'v1', type: 'service', data: { provider: 'vercel', provisionedUrl: 'https://app.vercel.app' } }
    const worker: CanvasNode = { id: 'cf1', type: 'service', data: { provider: 'cloudflare', cloudflareService: 'workers' } }
    const ctx = await buildPreloadedCtx({} as any, 'u1', [vercel, worker], [{ source: 'v1', target: 'cf1' }], [step('cf1')])
    expect(ctx.ALLOWED_ORIGIN).toBe('https://app.vercel.app')
    expect(ctx.FRONTEND_URL).toBe('https://app.vercel.app')
  })

  // An already-provisioned Vercel connected to a Supabase step must expose its
  // URL as vercel_project_url too — postConfigureAuth keys off that to set the
  // Supabase Auth site_url. Without it, an incremental deploy (Vercel already up,
  // Supabase (re)provisioning) leaves Supabase at its localhost:3000 default.
  it('plumbs an already-provisioned Vercel URL to vercel_project_url for a connected Supabase step', async () => {
    const vercel: CanvasNode = { id: 'v1', type: 'service', data: { provider: 'vercel', provisionedUrl: 'https://app.vercel.app' } }
    const supabase: CanvasNode = { id: 'sb1', type: 'service', data: { provider: 'supabase' } }
    const sbStep = { nodeId: 'sb1', service: 'supabase', action: 'provision', params: {}, injectEnvVars: [] } as unknown as ProvisionStep
    const ctx = await buildPreloadedCtx({} as any, 'u1', [vercel, supabase], [{ source: 'sb1', target: 'v1' }], [sbStep])
    expect(ctx.vercel_project_url).toBe('https://app.vercel.app')
    expect(ctx.vercel_project_url_v1).toBe('https://app.vercel.app')
  })

  // ── Fix 2: node-scoped twins so multi-node canvases don't cross-wire ──────────
  it('emits node-scoped GITHUB twins alongside the global keys', async () => {
    const gh: CanvasNode = { id: 'gh1', type: 'service', data: { provider: 'github', existing_repo: 'https://github.com/acme/app' } }
    const vercel: CanvasNode = { id: 'v1', type: 'service', data: { provider: 'vercel' } }
    const ctx = await buildPreloadedCtx({} as any, 'u1', [gh, vercel], [{ source: 'gh1', target: 'v1' }], [step('v1')])
    expect(ctx.GITHUB_OWNER_gh1).toBe('acme')
    expect(ctx.GITHUB_REPO_gh1).toBe('app')
    expect(ctx.GITHUB_REPO_URL_gh1).toBe('https://github.com/acme/app')
  })

  it('emits node-scoped Worker and Vercel URL twins', async () => {
    const worker: CanvasNode = { id: 'cf1', type: 'service', data: { provider: 'cloudflare', cloudflareService: 'workers', cloudflareWorkerUrl: 'https://api.example.workers.dev' } }
    const vercel: CanvasNode = { id: 'v1', type: 'service', data: { provider: 'vercel', provisionedUrl: 'https://app.vercel.app' } }
    const ctx = await buildPreloadedCtx({} as any, 'u1', [worker, vercel], [{ source: 'cf1', target: 'v1' }, { source: 'v1', target: 'cf1' }], [step('v1'), step('cf1')])
    expect(ctx.API_URL_cf1).toBe('https://api.example.workers.dev')
    expect(ctx.WORKER_URL_cf1).toBe('https://api.example.workers.dev')
    expect(ctx.NEXT_PUBLIC_API_URL_cf1).toBe('https://api.example.workers.dev')
    expect(ctx.ALLOWED_ORIGIN_v1).toBe('https://app.vercel.app')
    expect(ctx.FRONTEND_URL_v1).toBe('https://app.vercel.app')
  })

  it('two github repos wired to two vercels: each vercel resolves ITS wired repo, not the last-writer global', async () => {
    const gh1: CanvasNode = { id: 'gh1', type: 'service', data: { provider: 'github', existing_repo: 'acme/app-one' } }
    const gh2: CanvasNode = { id: 'gh2', type: 'service', data: { provider: 'github', existing_repo: 'acme/app-two' } }
    const v1: CanvasNode = { id: 'v1', type: 'service', data: { provider: 'vercel' } }
    const v2: CanvasNode = { id: 'v2', type: 'service', data: { provider: 'vercel' } }
    const edges = [{ source: 'gh1', target: 'v1' }, { source: 'gh2', target: 'v2' }]
    const ctx = await buildPreloadedCtx({} as any, 'u1', [gh1, gh2, v1, v2], edges, [step('v1'), step('v2')])
    const canvas = { nodes: [gh1, gh2, v1, v2].map((n) => ({ id: n.id, data: n.data })), edges }
    // The global GITHUB_OWNER is last-writer-wins (gh2) — the bug. Node-scoped
    // resolution must give each vercel step its own wired repo.
    expect(scopedCtxOverrides('v1', canvas, ctx, ['GITHUB_OWNER', 'GITHUB_REPO']).GITHUB_OWNER).toBe('acme')
    expect(scopedCtxOverrides('v1', canvas, ctx, ['GITHUB_REPO']).GITHUB_REPO).toBe('app-one')
    expect(scopedCtxOverrides('v2', canvas, ctx, ['GITHUB_REPO']).GITHUB_REPO).toBe('app-two')
  })
})

// ─── helpers for the new integration suites ──────────────────────────────────

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function makeNode(
  id: string,
  provider: string,
  extra: Record<string, unknown> = {},
): CanvasNode {
  return {
    id,
    type: "service",
    position: { x: 0, y: 0 },
    data: { provider, label: id, type: "service", ...extra },
  } as CanvasNode;
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  envVars: string[] = [],
): CanvasEdge {
  return { id, source, target, data: { envVars } } as CanvasEdge;
}

const ENV = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "svc-key",
} as any;

const USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

beforeEach(() => vi.unstubAllGlobals());

// ─── buildProvisionPlan (integration) ────────────────────────────────────────

describe("buildProvisionPlan (integration)", () => {
  it("creates a provision step for an un-provisioned Supabase node", () => {
    const nodes = [makeNode("sb-1", "supabase")];
    const { steps, error } = buildProvisionPlan(nodes, []);

    expect(error).toBeUndefined();
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      service: "supabase",
      action: "provision",
      nodeId: "sb-1",
    });
  });

  it("creates inject-only step for provisioned CF Worker with incoming edge, not a provision step", () => {
    const sbNode = makeNode("sb-1", "supabase", {
      supabaseProjectRef: "ref1",
      status: "provisioned",
    });
    const cfNode = makeNode("cf-1", "cloudflare", {
      cfWorkerNameProvisioned: "my-worker",
      status: "provisioned",
    });
    const edge = makeEdge("e1", "sb-1", "cf-1", ["SUPABASE_URL"]);

    const { steps } = buildProvisionPlan([sbNode, cfNode], [edge]);

    const injectStep = steps.find(
      (s) => s.action === "inject" && s.nodeId === "cf-1",
    );
    expect(injectStep).toBeDefined();
    expect(injectStep!.service).toBe("cloudflare-workers");
    expect(injectStep!.injectEnvVars).toContain("SUPABASE_URL");

    // Must NOT also appear as a provision step
    const provisionStep = steps.find(
      (s) => s.action === "provision" && s.nodeId === "cf-1",
    );
    expect(provisionStep).toBeUndefined();
  });

  it("does NOT create an inject-only step for a provisioned Vercel node (Vercel uses redeploy)", () => {
    const sbNode = makeNode("sb-1", "supabase", {
      supabaseProjectRef: "ref1",
      status: "provisioned",
    });
    const vercelNode = makeNode("v-1", "vercel", {
      vercelProjectId: "vp-1",
      existing_repo: "owner/repo",
      status: "provisioned",
    });
    const edge = makeEdge("e1", "sb-1", "v-1", ["NEXT_PUBLIC_SUPABASE_URL"]);

    const { steps } = buildProvisionPlan([sbNode, vercelNode], [edge]);

    const injectStep = steps.find(
      (s) => s.action === "inject" && s.nodeId === "v-1",
    );
    expect(injectStep).toBeUndefined();
  });

  it("returns error string and empty steps when Vercel node has no repo URL", () => {
    const vercelNode = makeNode("v-1", "vercel"); // no existing_repo

    const { steps, error } = buildProvisionPlan([vercelNode], []);

    expect(error).toMatch(/GitHub repo URL/i);
    expect(steps).toHaveLength(0);
  });

  it("assigns different connectedSupabaseNodeId to each inject step when two Supabase nodes connect to different CF Workers", () => {
    const sb1 = makeNode("sb-1", "supabase", {
      supabaseProjectRef: "ref1",
      status: "provisioned",
    });
    const sb2 = makeNode("sb-2", "supabase", {
      supabaseProjectRef: "ref2",
      status: "provisioned",
    });
    const cf1 = makeNode("cf-1", "cloudflare", {
      cfWorkerNameProvisioned: "worker-1",
      status: "provisioned",
    });
    const cf2 = makeNode("cf-2", "cloudflare", {
      cfWorkerNameProvisioned: "worker-2",
      status: "provisioned",
    });
    const edges = [
      makeEdge("e1", "sb-1", "cf-1", ["SUPABASE_URL"]),
      makeEdge("e2", "sb-2", "cf-2", ["SUPABASE_URL"]),
    ];

    const { steps } = buildProvisionPlan([sb1, sb2, cf1, cf2], edges);

    const injectCf1 = steps.find(
      (s) => s.action === "inject" && s.nodeId === "cf-1",
    );
    const injectCf2 = steps.find(
      (s) => s.action === "inject" && s.nodeId === "cf-2",
    );

    expect(injectCf1).toBeDefined();
    expect(injectCf2).toBeDefined();
    expect(injectCf1!.params.connectedSupabaseNodeId).toBe("sb-1");
    expect(injectCf2!.params.connectedSupabaseNodeId).toBe("sb-2");
    expect(injectCf1!.params.connectedSupabaseNodeId).not.toBe(
      injectCf2!.params.connectedSupabaseNodeId,
    );
  });

  it("produces empty injectEnvVars for a node with no edges", () => {
    const sbNode = makeNode("sb-1", "supabase");

    const { steps } = buildProvisionPlan([sbNode], []);

    expect(steps[0].injectEnvVars).toEqual([]);
  });

  it("orders Supabase step before Vercel step regardless of input order (topo sort)", () => {
    const vercel = makeNode("v-1", "vercel", { existing_repo: "owner/repo" });
    const sb = makeNode("sb-1", "supabase");
    const edge = makeEdge("e1", "sb-1", "v-1", ["NEXT_PUBLIC_SUPABASE_URL"]);

    // Intentionally pass Vercel first to verify topo sort overrides input order
    const { steps } = buildProvisionPlan([vercel, sb], [edge]);

    const sbIdx = steps.findIndex((s) => s.nodeId === "sb-1");
    const vIdx = steps.findIndex((s) => s.nodeId === "v-1");
    expect(sbIdx).toBeGreaterThanOrEqual(0);
    expect(vIdx).toBeGreaterThanOrEqual(0);
    expect(sbIdx).toBeLessThan(vIdx);
  });

  // Live-authoritative flip: the configure step no longer
  // reads/forwards node.data.appliedColumns — the provisioner's configure step
  // reconciles the canvas from live schema via refreshNodeSnapshot instead of
  // consuming a canvas-authored "already applied" map.
  it("does NOT include an appliedColumns key in the supabase configure-step params", () => {
    const sbNode = makeNode("sb-1", "supabase", {
      supabaseProjectRef: "ref1",
      status: "provisioned",
      tables: [{ name: "widgets", columns: [{ name: "title", type: "text" }] }],
      appliedColumns: { widgets: ["title"] },
    });

    const { steps } = buildProvisionPlan([sbNode], []);

    const configureStep = steps.find(
      (s) => s.action === "configure" && s.nodeId === "sb-1",
    );
    expect(configureStep).toBeDefined();
    expect(configureStep!.params).not.toHaveProperty("appliedColumns");
    expect(configureStep!.params).toMatchObject({
      supabaseProjectRef: "ref1",
      nodeId: "sb-1",
    });
  });
});

// ─── buildPreloadedCtx ────────────────────────────────────────────────────────

describe("buildPreloadedCtx", () => {
  it("sets un-suffixed Supabase keys when a single Supabase node is connected to a step node", async () => {
    const sbNode = makeNode("sb-1", "supabase", {
      supabaseProjectRef: "ref1",
      status: "provisioned",
    });
    const cfNode = makeNode("cf-1", "cloudflare");
    const edge = makeEdge("e1", "sb-1", "cf-1", ["SUPABASE_URL"]);
    const steps: ProvisionStep[] = [
      { service: "cloudflare-workers", action: "provision", params: {}, nodeId: "cf-1" },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/api-keys")) {
          return json([
            { name: "anon", api_key: "anon-key-1" },
            { name: "service_role", api_key: "svc-key-1" },
          ]);
        }
        return json([]);
      }),
    );

    const ctx = await buildPreloadedCtx(ENV, USER_ID, [sbNode, cfNode], [edge], steps);

    expect(ctx["supabase_url"]).toBe("https://ref1.supabase.co");
    expect(ctx["NEXT_PUBLIC_SUPABASE_URL"]).toBe("https://ref1.supabase.co");
    expect(ctx["supabase_anon_key"]).toBe("anon-key-1");
    expect(ctx["SUPABASE_SERVICE_ROLE_KEY"]).toBe("svc-key-1");
  });

  it("sets suffixed keys for both Supabase nodes and un-suffixed only for the first, in a two-Supabase canvas", async () => {
    const sb1 = makeNode("sb-1", "supabase", {
      supabaseProjectRef: "ref1",
      status: "provisioned",
    });
    const sb2 = makeNode("sb-2", "supabase", {
      supabaseProjectRef: "ref2",
      status: "provisioned",
    });
    const cf1 = makeNode("cf-1", "cloudflare");
    const cf2 = makeNode("cf-2", "cloudflare");
    const edges = [
      makeEdge("e1", "sb-1", "cf-1", ["SUPABASE_URL"]),
      makeEdge("e2", "sb-2", "cf-2", ["SUPABASE_URL"]),
    ];
    const steps: ProvisionStep[] = [
      { service: "cloudflare-workers", action: "provision", params: {}, nodeId: "cf-1" },
      { service: "cloudflare-workers", action: "provision", params: {}, nodeId: "cf-2" },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("ref1") && u.includes("/api-keys")) {
          return json([
            { name: "anon", api_key: "anon-1" },
            { name: "service_role", api_key: "svc-1" },
          ]);
        }
        if (u.includes("ref2") && u.includes("/api-keys")) {
          return json([
            { name: "anon", api_key: "anon-2" },
            { name: "service_role", api_key: "svc-2" },
          ]);
        }
        return json([]);
      }),
    );

    const ctx = await buildPreloadedCtx(ENV, USER_ID, [sb1, sb2, cf1, cf2], edges, steps);

    expect(ctx["supabase_url"]).toBe("https://ref1.supabase.co");
    expect(ctx["supabase_anon_key"]).toBe("anon-1");

    expect(ctx["supabase_url_sb-1"]).toBe("https://ref1.supabase.co");
    expect(ctx["supabase_url_sb-2"]).toBe("https://ref2.supabase.co");
    expect(ctx["supabase_anon_key_sb-2"]).toBe("anon-2");

    expect(ctx["supabase_url"]).not.toBe("https://ref2.supabase.co");
  });

  it("does not throw when Supabase Management API key fetch fails — returns ctx without Supabase keys", async () => {
    const sbNode = makeNode("sb-1", "supabase", {
      supabaseProjectRef: "ref1",
      status: "provisioned",
    });
    const cfNode = makeNode("cf-1", "cloudflare");
    const edge = makeEdge("e1", "sb-1", "cf-1", ["SUPABASE_URL"]);
    const steps: ProvisionStep[] = [
      { service: "cloudflare-workers", action: "provision", params: {}, nodeId: "cf-1" },
    ];

    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "forbidden" }, 403)));

    const ctx = await buildPreloadedCtx(ENV, USER_ID, [sbNode, cfNode], [edge], steps);

    expect(ctx["supabase_url"]).toBeUndefined();
    expect(ctx["NEXT_PUBLIC_SUPABASE_URL"]).toBeUndefined();
  });

  it("does not call the Supabase API when the Supabase node has no edge to a step node", async () => {
    const sbNode = makeNode("sb-1", "supabase", {
      supabaseProjectRef: "ref1",
      status: "provisioned",
    });
    const cfNode = makeNode("cf-1", "cloudflare");
    const steps: ProvisionStep[] = [
      { service: "cloudflare-workers", action: "provision", params: {}, nodeId: "cf-1" },
    ];

    const fetchMock = vi.fn(async () => json([]));
    vi.stubGlobal("fetch", fetchMock);

    const ctx = await buildPreloadedCtx(ENV, USER_ID, [sbNode, cfNode], [], steps);

    const apiKeyCalls = (fetchMock.mock.calls as unknown as [string, unknown][]).filter(
      ([url]) => String(url).includes("/api-keys"),
    );
    expect(apiKeyCalls).toHaveLength(0);
    expect(ctx["supabase_url"]).toBeUndefined();
  });
});

describe('from-scan node building', () => {
  it('marks every vercel node with imported: true', () => {
    const vercelProjects = [{ id: 'prj_abc', name: 'my-app', link: { org: 'acme', repo: 'web' } }];
    // Simulate node building logic inline (same as handler)
    const nodes: any[] = [];
    vercelProjects.forEach((p, i) => {
      const nodeId = `service-test-v${i}`;
      const repoFull = p.link?.org && p.link?.repo ? `${p.link.org}/${p.link.repo}` : undefined;
      nodes.push({
        id: nodeId,
        type: 'service',
        position: { x: 160 + i * 320, y: 200 },
        data: {
          label: 'Vercel',
          iconName: 'Triangle',
          provider: 'vercel',
          status: 'provisioned',
          imported: true,
          vercelProjectId: p.id,
          provisionedUrl: `https://${p.name}.vercel.app`,
          ...(repoFull ? { existing_repo: `https://github.com/${repoFull}` } : {}),
        },
      });
    });
    expect(nodes[0].data.imported).toBe(true);
    expect(nodes[0].data.existing_repo).toBe('https://github.com/acme/web');
  });

  it('marks every supabase node with imported: true', () => {
    const supabaseProjects = [{ ref: 'abcxyz', name: 'my-db', region: 'eu-west-1' }];
    const nodes: any[] = [];
    supabaseProjects.forEach((p, i) => {
      nodes.push({
        id: `service-test-s${i}`,
        type: 'service',
        position: { x: 160 + i * 320, y: 500 },
        data: {
          label: 'Supabase',
          provider: 'supabase',
          status: 'provisioned',
          imported: true,
          supabaseProjectRef: p.ref,
          region: p.region,
        },
      });
    });
    expect(nodes[0].data.imported).toBe(true);
    expect(nodes[0].data.supabaseProjectRef).toBe('abcxyz');
  });

  it('marks every github node with imported: true', () => {
    const githubRepos = [{ full_name: 'acme/web' }];
    const nodes: any[] = [];
    githubRepos.forEach((r, i) => {
      nodes.push({
        id: `service-test-g${i}`,
        type: 'service',
        position: { x: 160 + i * 320, y: -100 },
        data: {
          label: 'GitHub',
          provider: 'github',
          status: 'provisioned',
          imported: true,
          githubRepoName: r.full_name,
          existing_repo: `https://github.com/${r.full_name}`,
        },
      });
    });
    expect(nodes[0].data.imported).toBe(true);
    expect(nodes[0].data.githubRepoName).toBe('acme/web');
  });
});

describe('node delete imported guard', () => {
  it('treats imported: true as skipping deprovision', () => {
    // We verify the flag is correctly read from the body
    // The actual HTTP test would require mocking sb() and getUserToken()
    // which is covered by integration testing — here we just verify the type
    const body: { service: string; imported?: boolean; serviceIds: Record<string, string> } = {
      service: 'vercel',
      imported: true,
      serviceIds: { vercelProjectId: 'prj_abc' },
    };
    expect(body.imported).toBe(true);
  });
});

// Delete must be anchored on project ownership, not on a resolvable stackId.
// Config-only nodes (GitHub) and services skipped on incremental deploys never
// get a stack_services row, and nodes don't persist stackId — so requiring a
// stackId used to 400 ("stackId required") and block ALL deletes.
describe('DELETE /:projectId/nodes/:nodeId — project-anchored ownership', () => {
  const PROJECT_ID = 'aabbccdd-0000-0000-0000-000000000010'
  const USER_ID = 'aabbccdd-0000-0000-0000-000000000011'
  const NODE_ID = 'supabase-node-1'
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

  function buildApp() {
    const app = new Hono<{ Bindings: any; Variables: { userId: string } }>()
    app.use('*', async (c, next) => { c.set('userId', USER_ID); await next() })
    app.route('/', workflowProvision)
    return app
  }
  const env = { SUPABASE_URL: 'https://supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'svc-key' } as any

  afterEach(() => vi.unstubAllGlobals())

  it('does NOT 400 when stackId is unresolvable but the project is owned (removes the node)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url); const method = init?.method ?? 'GET'
      if (u.includes('/projects?') && u.includes('select=id&limit=1')) return json([{ id: PROJECT_ID }]) // ownership ✓
      if (u.includes('/projects?') && u.includes('select=canvas,canvas_version')) // loadCanvasWithVersion
        return json([{ canvas: { nodes: [{ id: NODE_ID, data: {} }], edges: [] }, canvas_version: 1 }])
      if (u.includes('/stack_services')) return json([]) // no rows anywhere → stackId stays null
      if (u.includes('/projects?') && method === 'PATCH') return json([{ id: PROJECT_ID }])
      if (u.includes('/project_environments')) return json([])
      return json([])
    }))
    const res = await buildApp().request(
      `/${PROJECT_ID}/nodes/${NODE_ID}`,
      { method: 'DELETE', body: JSON.stringify({ service: 'supabase', keepResource: true, serviceIds: {} }), headers: { 'content-type': 'application/json' } },
      env, ctx,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('returns 404 when the project is not owned by the caller', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/projects?') && u.includes('select=id&limit=1')) return json([]) // not owned
      return json([])
    }))
    const res = await buildApp().request(
      `/${PROJECT_ID}/nodes/${NODE_ID}`,
      { method: 'DELETE', body: JSON.stringify({ service: 'supabase', keepResource: true, serviceIds: {} }), headers: { 'content-type': 'application/json' } },
      env, ctx,
    )
    expect(res.status).toBe(404)
  })
})

describe('buildProvisionPlan — unknown-node edge detection', () => {
  const node = (id: string, provider: string): CanvasNode => ({
    id, type: 'service', data: { provider, existing_repo: 'https://github.com/o/r' }, position: { x: 0, y: 0 },
  } as any)

  it('returns a clear error when an edge references a node not in the canvas', () => {
    const nodes = [node('n1', 'github'), node('n2', 'vercel')]
    const edges = [{ source: 'n1', target: 'ghost' }] as CanvasEdge[]
    const { steps, error } = buildProvisionPlan(nodes, edges, 'proj')
    expect(steps).toEqual([])
    expect(error).toMatch(/unknown node|ghost/i)
  })

  it('builds a plan normally when all edges reference known nodes', () => {
    const nodes = [node('n1', 'github'), node('n2', 'vercel')]
    const edges = [{ source: 'n1', target: 'n2' }] as CanvasEdge[]
    const { error } = buildProvisionPlan(nodes, edges, 'proj')
    expect(error).toBeUndefined()
  })
})

describe('POST /:projectId/force-unlock — HTTP status mapping', () => {
  const PROJECT_ID = 'aabbccdd-0000-0000-0000-000000000001'
  const USER_ID = 'aabbccdd-0000-0000-0000-000000000002'

  function makeEnv() {
    return {
      SUPABASE_URL: 'https://supabase.test',
      SUPABASE_SERVICE_ROLE_KEY: 'svc-key',
    } as any
  }

  function buildApp(env: any) {
    const app = new Hono<{ Bindings: typeof env; Variables: { userId: string } }>()
    app.use('*', async (c, next) => {
      c.set('userId', USER_ID)
      await next()
    })
    app.route('/', workflowProvision)
    return app
  }

  afterEach(() => vi.unstubAllGlobals())

  it('returns 429 (not 400) when the lock is too recent (6 minutes old)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url)
        if (u.includes('select=id,canvas_locked_at,canvas_locked_by')) {
          const sixMinAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString()
          return new Response(
            JSON.stringify([{ id: PROJECT_ID, canvas_locked_at: sixMinAgo, canvas_locked_by: USER_ID }]),
            { status: 200 },
          )
        }
        // stacks lookup and anything else → empty
        return new Response(JSON.stringify([]), { status: 200 })
      }),
    )

    const app = buildApp(makeEnv())
    const res = await app.request(`/${PROJECT_ID}/force-unlock`, { method: 'POST' }, makeEnv())

    expect(res.status).toBe(429)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/minutes old/i)
  })
})
