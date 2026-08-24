import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── cloudflare-workers dispatch+poll — connector mocks ──────────────────────
// executeStep's cloudflare-workers branch calls straight into the connectors
// layer (github-app.ts, github-actions-secrets.ts, cloudflare.ts) — mock those
// modules directly rather than fetch, since this step's logic (repo parsing,
// poll loop, success/failure branching) is what's under test here, not the
// connectors' own HTTP behavior (already covered by their own test files).
vi.mock('./connectors/github-app', async () => {
  const actual = await vi.importActual<typeof import('./connectors/github-app')>('./connectors/github-app')
  return {
    ...actual,
    getInstallationTokenForRepo: vi.fn(),
    writeWorkflowFileAsApp: vi.fn(),
    dispatchWorkflow: vi.fn(),
    findWorkflowRun: vi.fn(),
    getWorkflowRunFailureTail: vi.fn(),
    getWranglerWorkerName: vi.fn(),
    pushLeenarCommitAsApp: vi.fn(),
    createGitHubDeployment: vi.fn(),
  }
})
vi.mock('./connectors/github-actions-secrets', async () => {
  const actual = await vi.importActual<typeof import('./connectors/github-actions-secrets')>('./connectors/github-actions-secrets')
  return {
    ...actual,
    putRepoActionsSecret: vi.fn(),
  }
})
vi.mock('./connectors/github', async () => {
  const actual = await vi.importActual<typeof import('./connectors/github')>('./connectors/github')
  return {
    ...actual,
    verifyRepo: vi.fn(),
    branchGitHub: vi.fn(),
  }
})
vi.mock('./connectors/capabilities', async () => {
  const actual = await vi.importActual<typeof import('./connectors/capabilities')>('./connectors/capabilities')
  return { ...actual, resolveBranchDecision: vi.fn() }
})
vi.mock('./connectors/cloudflare', async () => {
  const actual = await vi.importActual<typeof import('./connectors/cloudflare')>('./connectors/cloudflare')
  return {
    ...actual,
    getAccountId: vi.fn(),
    getWorkersSubdomain: vi.fn(),
    provisionR2: vi.fn(),
  }
})
vi.mock('./connectors/vercel', async () => {
  const actual = await vi.importActual<typeof import('./connectors/vercel')>('./connectors/vercel')
  return {
    ...actual,
    deprovisionVercel: vi.fn().mockResolvedValue(undefined),
    provisionVercel: vi.fn(),
  }
})
vi.mock('./connectors/supabase', async () => {
  const actual = await vi.importActual<typeof import('./connectors/supabase')>('./connectors/supabase')
  return {
    ...actual,
    deprovisionSupabase: vi.fn().mockResolvedValue(undefined),
    // Redeploy reconciles the canvas snapshot from live schema via
    // refreshNodeSnapshot instead of pushing seed columns with
    // applySupabaseAlterColumns (now removed). Spy on it here so tests can
    // assert it's invoked non-fatally, without needing to stub the
    // introspection/commitCanvasTables fetch chain it triggers internally.
    refreshNodeSnapshot: vi.fn().mockResolvedValue(undefined),
  }
})
vi.mock('./projectEvents', async () => {
  const actual = await vi.importActual<typeof import('./projectEvents')>('./projectEvents')
  return { ...actual, getProvisionedResources: vi.fn().mockResolvedValue([]) }
})
// The cancel/start fetch actions are gated behind DO token verification; stub it
// out so the cancel handler's own logic (status writes, watchdog cleanup) is what's
// under test here, not token auth (covered by doAuth.test.ts).
vi.mock('./doAuth', () => ({
  verifyDoToken: vi.fn().mockResolvedValue(true),
  signDoToken: vi.fn().mockResolvedValue('signed-token'),
}))

import { ProvisionerDO } from './provisioner.do'
import {
  getInstallationTokenForRepo,
  writeWorkflowFileAsApp,
  dispatchWorkflow,
  findWorkflowRun,
  getWorkflowRunFailureTail,
  getWranglerWorkerName,
} from './connectors/github-app'
import { putRepoActionsSecret } from './connectors/github-actions-secrets'
import { verifyRepo, branchGitHub } from './connectors/github'
import { resolveBranchDecision } from './connectors/capabilities'
import { getAccountId, getWorkersSubdomain, provisionR2 } from './connectors/cloudflare'
import { deprovisionVercel, provisionVercel } from './connectors/vercel'
import { pushLeenarCommitAsApp, createGitHubDeployment } from './connectors/github-app'
import { refreshNodeSnapshot } from './connectors/supabase'
import { getProvisionedResources } from './projectEvents'

const mockEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  GITHUB_APP_ID: 'app-1',
  GITHUB_APP_PRIVATE_KEY: 'dummy-pem',
} as any

/** Promises handed to state.waitUntil — tests assert what got detached, and
 *  await them so a detached rejection can't leak into a later test. */
const detached: Promise<unknown>[] = []

const mockState = {
  storage: {
    get: async () => null,
    put: async () => {},
    delete: async () => {},
    deleteAlarm: async () => {},
    setAlarm: async () => {},
  },
  waitUntil: (p: Promise<unknown>) => {
    detached.push(p)
  },
} as any

// updateSession/updateStatus are private — cast to `any` to exercise them directly,
// same pattern used to unit-test private persistence helpers without spinning up
// the whole provisioning flow.
function makeDO() {
  return new ProvisionerDO(mockState, mockEnv) as any
}

describe('ProvisionerDO status persistence (retry + defensive wrap)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('updateSession', () => {
    it('succeeds on the first attempt without retrying', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
      const do_ = makeDO()

      await do_.updateSession('sess-1', 'running')

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('retries up to 3 times on failure, then logs and does not throw', async () => {
      fetchMock.mockResolvedValue(new Response('server error', { status: 500 }))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const do_ = makeDO()

      await expect(
        do_.updateSession('sess-1', 'failed', 'boom'),
      ).resolves.toBeUndefined()

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(errorSpy).toHaveBeenCalled()
      const loggedLine = errorSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(loggedLine).toContain('provision.updateSession_persist_failed')
      // The real failure detail must survive into the log line, not be swallowed.
      expect(loggedLine).toContain('HTTP 500')

      errorSpy.mockRestore()
    })

    it('recovers if a later attempt succeeds (no error logged)', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response('err', { status: 500 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const do_ = makeDO()

      await do_.updateSession('sess-1', 'running')

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(errorSpy).not.toHaveBeenCalled()

      errorSpy.mockRestore()
    })

    it('does not throw even when fetch itself rejects on every attempt', async () => {
      fetchMock.mockRejectedValue(new Error('network down'))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const do_ = makeDO()

      await expect(
        do_.updateSession('sess-1', 'failed', 'boom'),
      ).resolves.toBeUndefined()

      expect(fetchMock).toHaveBeenCalledTimes(3)
      const loggedLine = errorSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(loggedLine).toContain('network down')

      errorSpy.mockRestore()
    })

    it('stamps a default error_message for a failed status when none is provided', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
      const do_ = makeDO()

      await do_.updateSession('sess-1', 'failed')

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      expect(body.error_message).toBe('Provisioning failed (no error detail captured)')
    })

    it('preserves the caller-provided error message for a failed status', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
      const do_ = makeDO()

      await do_.updateSession('sess-1', 'failed', 'vercel deploy failed: quota exceeded')

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      expect(body.error_message).toBe('vercel deploy failed: quota exceeded')
    })

    it('does not stamp error_message for non-failure statuses when none is provided', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
      const do_ = makeDO()

      await do_.updateSession('sess-1', 'running')

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      expect(body.error_message).toBeUndefined()
    })
  })

  describe('updateStatus', () => {
    it('succeeds on the first attempt without retrying', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
      const do_ = makeDO()

      await do_.updateStatus('stack-1', 'active')

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('retries up to 3 times on failure, then logs and does not throw', async () => {
      fetchMock.mockResolvedValue(new Response('server error', { status: 503 }))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const do_ = makeDO()

      await expect(do_.updateStatus('stack-1', 'error')).resolves.toBeUndefined()

      expect(fetchMock).toHaveBeenCalledTimes(3)
      const loggedLine = errorSpy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(loggedLine).toContain('provision.updateStatus_persist_failed')
      expect(loggedLine).toContain('HTTP 503')

      errorSpy.mockRestore()
    })
  })

  describe('updateProjectStatus', () => {
    it('PATCHes projects with the given status and stops on success', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
      const do_ = makeDO()

      await (do_ as any).updateProjectStatus('proj-1', 'active')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toContain('/projects?id=eq.proj-1')
      expect(init.method).toBe('PATCH')
      expect(JSON.parse(init.body as string)).toEqual({ status: 'active' })
    })

    it('retries up to 3× then gives up WITHOUT throwing', async () => {
      fetchMock.mockResolvedValue(new Response('server error', { status: 500 }))

      const do_ = makeDO()
      await expect(
        (do_ as any).updateProjectStatus('proj-1', 'error'),
      ).resolves.toBeUndefined()

      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('never throws on network failure', async () => {
      fetchMock.mockRejectedValue(new Error('network down'))

      const do_ = makeDO()
      await expect(
        (do_ as any).updateProjectStatus('proj-1', 'active'),
      ).resolves.toBeUndefined()

      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
  })
})

// --- Cloudflare Worker preflight — must fail fast, before any provisioning ---
describe('ProvisionerDO.runWithSession — Cloudflare Worker GitHub-repo preflight', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  // Generic Supabase REST responder: satisfies the stack-row lookup, canvas lookup,
  // and every other `sb()`/event-sourcing call runWithSession makes on the way to
  // (and, on failure, after) the preflight — none of it matters for this test except
  // that it resolves so runWithSession's own try/catch is what we're exercising.
  function stubSupabase(overrides: Partial<Record<string, unknown>> = {}) {
    fetchMock = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/rest/v1/stacks?id=eq.')) {
        return new Response(
          JSON.stringify([
            { project_id: 'project-1', environment_id: 'env-1' },
          ]),
          { status: 200 },
        )
      }
      if (u.includes('/rest/v1/projects?id=eq.')) {
        return new Response(
          JSON.stringify([{ canvas: { nodes: [], edges: [] } }]),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify(overrides.default ?? []), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws before provisioning when a cloudflare-workers step is missing existing_repo', async () => {
    stubSupabase()
    const do_ = makeDO()
    const executeStepSpy = vi
      .spyOn(do_, 'executeStep' as any)
      .mockResolvedValue({})
    const updateSessionSpy = vi.spyOn(do_, 'updateSession').mockResolvedValue(undefined)
    const updateStatusSpy = vi.spyOn(do_, 'updateStatus').mockResolvedValue(undefined)

    const stack = {
      projectName: 'My App',
      steps: [
        {
          service: 'cloudflare-workers',
          action: 'provision',
          params: {}, // no existing_repo
          nodeId: 'node-1',
          nodeLabel: 'Workers',
        },
      ],
    }

    await do_.runWithSession('sess-1', 'stack-1', 'user-1', stack)

    // The step-execution loop must never be reached.
    expect(executeStepSpy).not.toHaveBeenCalled()
    // Failure must be persisted with the actionable preflight message.
    expect(updateSessionSpy).toHaveBeenCalledWith(
      'sess-1',
      'failed',
      expect.stringContaining('Cloudflare Worker node needs a GitHub repo'),
    )
    expect(updateStatusSpy).toHaveBeenCalledWith('stack-1', 'error')
  })

  it('does not throw the preflight error when existing_repo is set (proceeds toward provisioning)', async () => {
    stubSupabase()
    const do_ = makeDO()
    const executeStepSpy = vi
      .spyOn(do_, 'executeStep' as any)
      .mockResolvedValue({})
    const updateSessionSpy = vi.spyOn(do_, 'updateSession').mockResolvedValue(undefined)
    vi.spyOn(do_, 'updateStatus').mockResolvedValue(undefined)
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('fake-token')

    const stack = {
      projectName: 'My App',
      steps: [
        {
          service: 'cloudflare-workers',
          action: 'provision',
          params: { existing_repo: 'https://github.com/user/repo' },
          nodeId: 'node-1',
          nodeLabel: 'Workers',
        },
      ],
    }

    await do_.runWithSession('sess-1', 'stack-1', 'user-1', stack)

    // Step loop should have been reached this time.
    expect(executeStepSpy).toHaveBeenCalled()
    // No failure persisted with the preflight's error message.
    const failedCalls = updateSessionSpy.mock.calls.filter((c) => c[1] === 'failed')
    for (const call of failedCalls) {
      expect(String(call[2])).not.toContain('Cloudflare Worker node needs a GitHub repo')
    }
  })

  it('does not throw the preflight error for an inject-only cloudflare-workers step (already-provisioned worker, no repo needed)', async () => {
    // Redeploy of a fully-provisioned stack: the worker only needs env vars
    // injected, so its step carries no existing_repo. The repo pre-flight must
    // not gate inject/configure steps — only the code-deploying "provision" action.
    stubSupabase()
    const do_ = makeDO()
    const executeStepSpy = vi
      .spyOn(do_, 'executeStep' as any)
      .mockResolvedValue({})
    const updateSessionSpy = vi.spyOn(do_, 'updateSession').mockResolvedValue(undefined)
    vi.spyOn(do_, 'updateStatus').mockResolvedValue(undefined)
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('fake-token')

    const stack = {
      projectName: 'My App',
      steps: [
        {
          service: 'cloudflare-workers',
          action: 'inject',
          params: { cfWorkerNameProvisioned: 'my-worker' }, // no existing_repo, by design
          nodeId: 'node-1',
          nodeLabel: 'Workers',
          injectEnvVars: ['R2_BUCKET'],
        },
      ],
    }

    await do_.runWithSession('sess-1', 'stack-1', 'user-1', stack)

    // Step loop must be reached — the inject step is not blocked by the repo pre-flight.
    expect(executeStepSpy).toHaveBeenCalled()
    const failedCalls = updateSessionSpy.mock.calls.filter((c) => c[1] === 'failed')
    for (const call of failedCalls) {
      expect(String(call[2])).not.toContain('Cloudflare Worker node needs a GitHub repo')
    }
  })

  it('leaves the existing Vercel preflight behavior unchanged (still fails without a repo)', async () => {
    stubSupabase()
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('fake-vercel-token')
    const updateSessionSpy = vi.spyOn(do_, 'updateSession').mockResolvedValue(undefined)
    vi.spyOn(do_, 'updateStatus').mockResolvedValue(undefined)

    const stack = {
      projectName: 'My App',
      steps: [
        {
          service: 'vercel',
          action: 'provision',
          params: {},
          nodeId: 'node-1',
          nodeLabel: 'Vercel',
        },
      ],
    }

    await do_.runWithSession('sess-1', 'stack-1', 'user-1', stack)

    // assertVercelGitHubLinked hits the real Vercel API with a fake token and should
    // fail (network/auth error), proving the Vercel preflight branch still executes.
    expect(updateSessionSpy).toHaveBeenCalledWith(
      'sess-1',
      'failed',
      expect.any(String),
    )
  })
})

// --- vercel step — critical path vs. detached side effects ---
describe('ProvisionerDO.executeStep — vercel step latency shape', () => {
  beforeEach(() => {
    detached.length = 0
    vi.mocked(provisionVercel).mockResolvedValue({
      vercel_project_id: 'prj_1',
      vercel_project_url: 'https://widgets.vercel.app',
    } as any)
    vi.mocked(getInstallationTokenForRepo).mockResolvedValue('gh-install-token')
    vi.mocked(pushLeenarCommitAsApp).mockResolvedValue(undefined as any)
    vi.mocked(createGitHubDeployment).mockResolvedValue(undefined as any)
  })

  afterEach(() => {
    detached.length = 0
    vi.clearAllMocks()
  })

  function makeVercelStep() {
    return {
      service: 'vercel',
      action: 'provision',
      params: { existing_repo: 'acme/widgets' },
      nodeId: 'node-1',
      nodeLabel: 'Vercel',
    } as any
  }

  it('the branded commit and the GitHub deployment marker are detached, not awaited in the step', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('vercel-token')

    // Both side effects hang forever. If the step awaited them it could never
    // resolve — so resolving at all is the assertion.
    vi.mocked(pushLeenarCommitAsApp).mockReturnValue(new Promise(() => {}) as any)

    const result = await do_.executeStep(makeVercelStep(), {} as Record<string, string>, 'user-1', 'My Project')

    expect(result.vercel_project_url).toBe('https://widgets.vercel.app')
    expect(detached).toHaveLength(1)
  })

  it('a branch deploy mints ONE installation token for the step, not one per consumer', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('vercel-token')
    // Branch mode makes two independent consumers (git-branch creation and
    // framework detection) need the same repo's token in one step.
    do_.branchCtx = { branchKey: 'feat-x', trunkState: {} }
    vi.mocked(resolveBranchDecision).mockResolvedValue({ mode: 'native' } as any)
    vi.mocked(branchGitHub).mockResolvedValue(undefined as any)

    await do_.executeStep(makeVercelStep(), {} as Record<string, string>, 'user-1', 'My Project')
    await Promise.all(detached)

    expect(vi.mocked(branchGitHub)).toHaveBeenCalledWith('gh-install-token', expect.anything())
    expect(vi.mocked(getInstallationTokenForRepo)).toHaveBeenCalledTimes(1)
  })
})

// --- cloudflare-workers step — dispatch + poll ---
describe('ProvisionerDO.executeStep — cloudflare-workers dispatch + poll', () => {
  beforeEach(() => {
    vi.stubGlobal('scheduler', { wait: vi.fn(async () => {}) })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  function makeStep(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      service: 'cloudflare-workers',
      action: 'provision',
      params: { existing_repo: 'https://github.com/acme/widgets', ...overrides },
      nodeId: 'node-1',
      nodeLabel: 'Worker',
    } as any
  }

  it('happy path: dispatch -> run appears -> completes successfully -> URL derived', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('cf-user-token')

    vi.mocked(getInstallationTokenForRepo).mockResolvedValue('gh-install-token')
    vi.mocked(verifyRepo).mockResolvedValue({ full_name: 'acme/widgets', html_url: 'https://github.com/acme/widgets', default_branch: 'main' })
    vi.mocked(putRepoActionsSecret).mockResolvedValue(undefined)
    vi.mocked(writeWorkflowFileAsApp).mockResolvedValue(true)
    vi.mocked(dispatchWorkflow).mockResolvedValue(undefined)
    vi.mocked(getAccountId).mockResolvedValue('cf-account-id')
    vi.mocked(getWorkersSubdomain).mockResolvedValue('acme-sub')
    vi.mocked(getWranglerWorkerName).mockResolvedValue('acme-worker')

    // First poll: run not found yet (null). Second poll: in_progress. Third: completed/success.
    vi.mocked(findWorkflowRun)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 555, status: 'in_progress', conclusion: null, html_url: 'https://github.com/acme/widgets/actions/runs/555' })
      .mockResolvedValueOnce({ id: 555, status: 'completed', conclusion: 'success', html_url: 'https://github.com/acme/widgets/actions/runs/555' })

    const ctx: Record<string, string> = {}
    const result = await do_.executeStep(makeStep(), ctx, 'user-1', 'My Project')

    expect(result.cloudflare_account_id).toBe('cf-account-id')
    expect(result.cloudflare_worker_name).toBe('acme-worker')
    expect(result.cloudflare_worker_url).toBe('https://acme-worker.acme-sub.workers.dev')
    expect(result.CLOUDFLARE_WORKER_URL).toBe('https://acme-worker.acme-sub.workers.dev')

    expect(putRepoActionsSecret).toHaveBeenCalledWith('gh-install-token', 'acme/widgets', 'CLOUDFLARE_API_TOKEN', 'cf-user-token')
    expect(putRepoActionsSecret).toHaveBeenCalledWith('gh-install-token', 'acme/widgets', 'CLOUDFLARE_ACCOUNT_ID', 'cf-account-id')
    // 4th arg is the branch-mode opts — undefined on a normal (non-branch) deploy.
    expect(writeWorkflowFileAsApp).toHaveBeenCalledWith('app-1', 'dummy-pem', 'acme/widgets', undefined)
    expect(dispatchWorkflow).toHaveBeenCalledWith('gh-install-token', 'acme/widgets', 'leenar-deploy.yml', 'main', { signal: expect.any(AbortSignal) })
    expect(findWorkflowRun).toHaveBeenCalledTimes(3)
  })

  it('poll cadence ramps: the early checks (while GitHub is still creating the run) are short, the tail settles at 15s', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('cf-user-token')

    vi.mocked(getInstallationTokenForRepo).mockResolvedValue('gh-install-token')
    vi.mocked(verifyRepo).mockResolvedValue({ full_name: 'acme/widgets', html_url: 'https://github.com/acme/widgets', default_branch: 'main' })
    vi.mocked(putRepoActionsSecret).mockResolvedValue(undefined)
    vi.mocked(writeWorkflowFileAsApp).mockResolvedValue(true)
    vi.mocked(dispatchWorkflow).mockResolvedValue(undefined)
    vi.mocked(getAccountId).mockResolvedValue('cf-account-id')
    vi.mocked(getWorkersSubdomain).mockResolvedValue('acme-sub')
    vi.mocked(getWranglerWorkerName).mockResolvedValue('acme-worker')

    // Six misses, then completion — enough to walk off the end of the ramp.
    for (let i = 0; i < 6; i++) vi.mocked(findWorkflowRun).mockResolvedValueOnce(null)
    vi.mocked(findWorkflowRun).mockResolvedValueOnce({ id: 555, status: 'completed', conclusion: 'success', html_url: 'https://github.com/acme/widgets/actions/runs/555' })

    await do_.executeStep(makeStep(), {} as Record<string, string>, 'user-1', 'My Project')

    const waits = vi.mocked((globalThis as any).scheduler.wait).mock.calls.map((c: unknown[]) => c[0])
    expect(waits).toEqual([3000, 3000, 5000, 8000, 15000, 15000])
  })

  it('resolves the dispatch branch from verifyRepo, ignoring ctx.github_default_branch entirely', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('cf-user-token')
    vi.mocked(getInstallationTokenForRepo).mockResolvedValue('gh-install-token')
    // The repo's REAL default branch (from GitHub) differs from the stale ctx value —
    // verifyRepo's result must win, proving the ctx.github_default_branch fallback is gone.
    vi.mocked(verifyRepo).mockResolvedValue({ full_name: 'acme/widgets', html_url: 'https://github.com/acme/widgets', default_branch: 'develop' })
    vi.mocked(putRepoActionsSecret).mockResolvedValue(undefined)
    vi.mocked(writeWorkflowFileAsApp).mockResolvedValue(true)
    vi.mocked(dispatchWorkflow).mockResolvedValue(undefined)
    vi.mocked(getAccountId).mockResolvedValue('cf-account-id')
    vi.mocked(getWorkersSubdomain).mockResolvedValue('')
    vi.mocked(getWranglerWorkerName).mockResolvedValue('acme-worker')
    vi.mocked(findWorkflowRun).mockResolvedValueOnce({
      id: 1, status: 'completed', conclusion: 'success', html_url: 'https://x/1',
    })

    // Stale/mismatched ctx value — must be ignored in favor of verifyRepo's result.
    const ctx: Record<string, string> = { github_default_branch: 'main' }
    await do_.executeStep(makeStep(), ctx, 'user-1', 'My Project')

    expect(verifyRepo).toHaveBeenCalledWith('gh-install-token', 'acme/widgets')
    expect(dispatchWorkflow).toHaveBeenCalledWith('gh-install-token', 'acme/widgets', 'leenar-deploy.yml', 'develop', { signal: expect.any(AbortSignal) })
  })

  it('resolves the dispatch branch from verifyRepo even when ctx.github_default_branch is absent (already-connected repo case)', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('cf-user-token')
    vi.mocked(getInstallationTokenForRepo).mockResolvedValue('gh-install-token')
    vi.mocked(verifyRepo).mockResolvedValue({ full_name: 'acme/widgets', html_url: 'https://github.com/acme/widgets', default_branch: 'master' })
    vi.mocked(putRepoActionsSecret).mockResolvedValue(undefined)
    vi.mocked(writeWorkflowFileAsApp).mockResolvedValue(true)
    vi.mocked(dispatchWorkflow).mockResolvedValue(undefined)
    vi.mocked(getAccountId).mockResolvedValue('cf-account-id')
    vi.mocked(getWorkersSubdomain).mockResolvedValue('')
    vi.mocked(getWranglerWorkerName).mockResolvedValue('acme-worker')
    vi.mocked(findWorkflowRun).mockResolvedValueOnce({
      id: 1, status: 'completed', conclusion: 'success', html_url: 'https://x/1',
    })

    // No github_default_branch in ctx at all — the pre-fix code would have silently
    // fallen back to "main", 404ing/dispatching against the wrong branch.
    const ctx: Record<string, string> = {}
    await do_.executeStep(makeStep(), ctx, 'user-1', 'My Project')

    expect(dispatchWorkflow).toHaveBeenCalledWith('gh-install-token', 'acme/widgets', 'leenar-deploy.yml', 'master', { signal: expect.any(AbortSignal) })
  })

  it('idempotent replay: a persisted dispatch marker prevents a second wrangler deploy after mid-poll eviction', async () => {
    const do_ = makeDO()
    // Simulate a DO that already dispatched this node's deploy in a prior isolate:
    // the marker survives in durable storage even though in-memory ctx is empty.
    do_.state = {
      storage: {
        get: async (k: string) =>
          k === 'dispatch:node-1' ? '2026-01-01T00:00:00.000Z' : null,
        put: async () => {},
        delete: async () => {},
        deleteAlarm: async () => {},
        setAlarm: async () => {},
      },
      waitUntil: () => {},
    }
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('cf-user-token')
    vi.mocked(getInstallationTokenForRepo).mockResolvedValue('gh-install-token')
    vi.mocked(verifyRepo).mockResolvedValue({ full_name: 'acme/widgets', html_url: 'https://github.com/acme/widgets', default_branch: 'main' })
    vi.mocked(putRepoActionsSecret).mockResolvedValue(undefined)
    vi.mocked(writeWorkflowFileAsApp).mockResolvedValue(true)
    vi.mocked(dispatchWorkflow).mockResolvedValue(undefined)
    vi.mocked(getAccountId).mockResolvedValue('cf-account-id')
    vi.mocked(getWorkersSubdomain).mockResolvedValue('acme-sub')
    vi.mocked(getWranglerWorkerName).mockResolvedValue('acme-worker')
    // The already-dispatched run is found immediately and completes.
    vi.mocked(findWorkflowRun).mockResolvedValueOnce({
      id: 777, status: 'completed', conclusion: 'success', html_url: 'https://x/777',
    })

    const ctx: Record<string, string> = {}
    const result = await do_.executeStep(makeStep(), ctx, 'user-1', 'My Project')

    // Crucially: no second dispatch — the persisted marker short-circuits it.
    expect(dispatchWorkflow).not.toHaveBeenCalled()
    // The step still resolves normally by polling the already-dispatched run.
    expect(result.cloudflare_worker_url).toBe('https://acme-worker.acme-sub.workers.dev')
  })

  it('App-not-installed: getInstallationTokenForRepo returning null throws a clear, actionable error', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('cf-user-token')
    vi.mocked(getInstallationTokenForRepo).mockResolvedValue(null)

    const ctx: Record<string, string> = {}
    await expect(
      do_.executeStep(makeStep(), ctx, 'user-1', 'My Project'),
    ).rejects.toThrow(/GitHub App is not installed on acme\/widgets/)

    expect(putRepoActionsSecret).not.toHaveBeenCalled()
    expect(dispatchWorkflow).not.toHaveBeenCalled()
  })

  it('throws a clear error when existing_repo is missing/invalid', async () => {
    const do_ = makeDO()
    const ctx: Record<string, string> = {}
    await expect(
      do_.executeStep(makeStep({ existing_repo: 'not a valid repo' }), ctx, 'user-1', 'My Project'),
    ).rejects.toThrow(/invalid or missing GitHub repo/)
  })

  it('run failure: conclusion !== success throws an Error whose message includes the annotation tail', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('cf-user-token')
    vi.mocked(getInstallationTokenForRepo).mockResolvedValue('gh-install-token')
    vi.mocked(verifyRepo).mockResolvedValue({ full_name: 'acme/widgets', html_url: 'https://github.com/acme/widgets', default_branch: 'main' })
    vi.mocked(putRepoActionsSecret).mockResolvedValue(undefined)
    vi.mocked(writeWorkflowFileAsApp).mockResolvedValue(true)
    vi.mocked(dispatchWorkflow).mockResolvedValue(undefined)
    vi.mocked(getAccountId).mockResolvedValue('cf-account-id')
    vi.mocked(findWorkflowRun).mockResolvedValueOnce({
      id: 777,
      status: 'completed',
      conclusion: 'failure',
      html_url: 'https://github.com/acme/widgets/actions/runs/777',
    })
    vi.mocked(getWorkflowRunFailureTail).mockResolvedValue('wrangler.toml missing account_id')

    const ctx: Record<string, string> = {}
    await expect(
      do_.executeStep(makeStep(), ctx, 'user-1', 'My Project'),
    ).rejects.toThrow(/wrangler\.toml missing account_id/)

    expect(getWorkflowRunFailureTail).toHaveBeenCalledWith('gh-install-token', 'acme/widgets', 777)
    // URL-derivation calls must not happen on the failure path
    expect(getWranglerWorkerName).not.toHaveBeenCalled()
  })

  it('propagates a missing-wrangler-config error from writeWorkflowFileAsApp without swallowing it', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('cf-user-token')
    vi.mocked(getInstallationTokenForRepo).mockResolvedValue('gh-install-token')
    vi.mocked(verifyRepo).mockResolvedValue({ full_name: 'acme/widgets', html_url: 'https://github.com/acme/widgets', default_branch: 'main' })
    vi.mocked(putRepoActionsSecret).mockResolvedValue(undefined)
    vi.mocked(getAccountId).mockResolvedValue('cf-account-id')
    vi.mocked(writeWorkflowFileAsApp).mockRejectedValue(
      new Error('No wrangler.toml or wrangler.jsonc found in acme/widgets. Add a Wrangler config file to your repo before deploying.'),
    )

    const ctx: Record<string, string> = {}
    await expect(
      do_.executeStep(makeStep(), ctx, 'user-1', 'My Project'),
    ).rejects.toThrow(/No wrangler\.toml or wrangler\.jsonc found/)

    expect(dispatchWorkflow).not.toHaveBeenCalled()
  })

  it('write-fails (returns false, does not throw): throws a clear actionable error and never dispatches', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('cf-user-token')
    vi.mocked(getInstallationTokenForRepo).mockResolvedValue('gh-install-token')
    vi.mocked(verifyRepo).mockResolvedValue({ full_name: 'acme/widgets', html_url: 'https://github.com/acme/widgets', default_branch: 'main' })
    vi.mocked(putRepoActionsSecret).mockResolvedValue(undefined)
    vi.mocked(getAccountId).mockResolvedValue('cf-account-id')
    // writeWorkflowFileAsApp resolves false (not a throw) — e.g. a transient PUT 500.
    vi.mocked(writeWorkflowFileAsApp).mockResolvedValue(false)

    const ctx: Record<string, string> = {}
    await expect(
      do_.executeStep(makeStep(), ctx, 'user-1', 'My Project'),
    ).rejects.toThrow(/Failed to write the Leenar deploy workflow to acme\/widgets/)

    expect(dispatchWorkflow).not.toHaveBeenCalled()
  })

  it('abort-signal respect: a poll loop that would otherwise continue exits promptly when the signal is already aborted', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('cf-user-token')
    vi.mocked(getInstallationTokenForRepo).mockResolvedValue('gh-install-token')
    vi.mocked(verifyRepo).mockResolvedValue({ full_name: 'acme/widgets', html_url: 'https://github.com/acme/widgets', default_branch: 'main' })
    vi.mocked(putRepoActionsSecret).mockResolvedValue(undefined)
    vi.mocked(writeWorkflowFileAsApp).mockResolvedValue(true)
    vi.mocked(dispatchWorkflow).mockResolvedValue(undefined)
    vi.mocked(getAccountId).mockResolvedValue('cf-account-id')
    // Run never shows up — if the loop didn't respect abort, it would poll forever.
    vi.mocked(findWorkflowRun).mockResolvedValue(null)

    // Abort before executeStep is even called, simulating the DO's 10-minute
    // budget (or a user cancel) having already fired.
    do_.abortController.abort()

    const ctx: Record<string, string> = {}
    await expect(
      do_.executeStep(makeStep(), ctx, 'user-1', 'My Project'),
    ).rejects.toThrow(/aborted/)

    // The loop must exit on its own abort check, not rely on findWorkflowRun ever resolving —
    // confirm it did not spin: called at most once (the pre-loop-body abort check fires first).
    expect(findWorkflowRun).not.toHaveBeenCalled()
  })

  // --- Final-review Finding 2: outer MAX_ATTEMPTS retry loop (runWithSession)
  // re-runs this whole step body from scratch on any thrown error. A dispatch
  // marker persisted in the shared `ctx` object must prevent a second, real
  // dispatchWorkflow call when only the post-dispatch polling failed. Exercised
  // by calling executeStep twice with the SAME ctx object — the same pattern
  // the outer loop uses (ctx is a single object threaded across attempts; only
  // successful-step output is Object.assign'd onto it, but this step mutates
  // ctx directly for the marker regardless of success/failure).
  it('double-dispatch prevention: dispatch succeeds, poll throws once, retry succeeds — dispatchWorkflow called exactly once', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('cf-user-token')
    vi.mocked(getInstallationTokenForRepo).mockResolvedValue('gh-install-token')
    vi.mocked(verifyRepo).mockResolvedValue({ full_name: 'acme/widgets', html_url: 'https://github.com/acme/widgets', default_branch: 'main' })
    vi.mocked(putRepoActionsSecret).mockResolvedValue(undefined)
    vi.mocked(writeWorkflowFileAsApp).mockResolvedValue(true)
    vi.mocked(dispatchWorkflow).mockResolvedValue(undefined)
    vi.mocked(getAccountId).mockResolvedValue('cf-account-id')
    vi.mocked(getWorkersSubdomain).mockResolvedValue('acme-sub')
    vi.mocked(getWranglerWorkerName).mockResolvedValue('acme-worker')

    // Attempt 1: findWorkflowRun throws (simulating a transient GitHub API error
    // during polling) — this happens AFTER dispatchWorkflow already succeeded.
    vi.mocked(findWorkflowRun).mockRejectedValueOnce(
      new Error('GitHub API 502: transient error'),
    )

    const ctx: Record<string, string> = {}
    const step = makeStep()

    // Attempt 1 — dispatch succeeds, then polling throws. Same ctx object is
    // reused, mirroring the outer MAX_ATTEMPTS loop in runWithSession.
    await expect(
      do_.executeStep(step, ctx, 'user-1', 'My Project'),
    ).rejects.toThrow(/transient error/)

    expect(dispatchWorkflow).toHaveBeenCalledTimes(1)
    // The dispatch marker must now be recorded on the shared ctx.
    expect(ctx['_cf_workflow_dispatched_at_node-1']).toBeTruthy()

    // Attempt 2 (the retry): polling now succeeds. dispatchWorkflow must NOT
    // be called again — the step must skip straight to polling, reusing the
    // SAME dispatchedAfter timestamp recovered from ctx.
    vi.mocked(findWorkflowRun).mockResolvedValueOnce({
      id: 999,
      status: 'completed',
      conclusion: 'success',
      html_url: 'https://github.com/acme/widgets/actions/runs/999',
    })

    const result = await do_.executeStep(step, ctx, 'user-1', 'My Project')

    expect(result.github_run_id).toBe('999')
    // Across BOTH attempts, dispatchWorkflow (the underlying dispatches-endpoint
    // call) must have fired exactly once — never twice for one logical deploy.
    expect(dispatchWorkflow).toHaveBeenCalledTimes(1)
  })
})

// --- R2 credentials-pending warning is gated on real edge
// topology — only fires for a genuine R2 -> Vercel edge, and names the real
// target node instead of a hardcoded "Vercel" string. ---
describe('ProvisionerDO.executeStep — cloudflare-r2 R2CredentialsPending warning gating', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  function makeR2Step(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      service: 'cloudflare-r2',
      action: 'provision',
      params: {},
      nodeId: 'r2-node',
      nodeLabel: 'R2 Bucket',
      ...overrides,
    } as any
  }

  function makeCanvas(
    nodes: Array<{ id: string; data: Record<string, unknown> }>,
    edges: Array<{ source: string; target: string }>,
  ) {
    return { nodes, edges }
  }

  it('no outgoing edge from the R2 node -> warning is suppressed entirely', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('cf-user-token')
    vi.mocked(getAccountId).mockResolvedValue('cf-account-id')
    vi.mocked(provisionR2).mockResolvedValue({
      r2_bucket_name: 'my-bucket',
      r2_credentials_pending: true,
    } as any)

    const canvas = makeCanvas(
      [{ id: 'r2-node', data: { provider: 'cloudflare', cloudflareService: 'r2' } }],
      [],
    )
    const emitEvent = vi.fn()
    const ctx: Record<string, string> = {}
    await do_.executeStep(makeR2Step(), ctx, 'user-1', 'My Project', undefined, undefined, emitEvent, canvas)

    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('R2 -> Cloudflare Worker edge (native binding path) -> warning is suppressed entirely', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('cf-user-token')
    vi.mocked(getAccountId).mockResolvedValue('cf-account-id')
    vi.mocked(provisionR2).mockResolvedValue({
      r2_bucket_name: 'my-bucket',
      r2_credentials_pending: true,
    } as any)

    const canvas = makeCanvas(
      [
        { id: 'r2-node', data: { provider: 'cloudflare', cloudflareService: 'r2' } },
        { id: 'worker-node', data: { provider: 'cloudflare', label: 'My Worker' } },
      ],
      [{ source: 'r2-node', target: 'worker-node' }],
    )
    const emitEvent = vi.fn()
    const ctx: Record<string, string> = {}
    await do_.executeStep(makeR2Step(), ctx, 'user-1', 'My Project', undefined, undefined, emitEvent, canvas)

    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('R2 -> other service (not Vercel, not Worker) -> warning is suppressed entirely', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('cf-user-token')
    vi.mocked(getAccountId).mockResolvedValue('cf-account-id')
    vi.mocked(provisionR2).mockResolvedValue({
      r2_bucket_name: 'my-bucket',
      r2_credentials_pending: true,
    } as any)

    const canvas = makeCanvas(
      [
        { id: 'r2-node', data: { provider: 'cloudflare', cloudflareService: 'r2' } },
        { id: 'sb-node', data: { provider: 'supabase', label: 'My Supabase' } },
      ],
      [{ source: 'r2-node', target: 'sb-node' }],
    )
    const emitEvent = vi.fn()
    const ctx: Record<string, string> = {}
    await do_.executeStep(makeR2Step(), ctx, 'user-1', 'My Project', undefined, undefined, emitEvent, canvas)

    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('R2 -> Vercel edge -> warning IS emitted and names the real target node label', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('cf-user-token')
    vi.mocked(getAccountId).mockResolvedValue('cf-account-id')
    vi.mocked(provisionR2).mockResolvedValue({
      r2_bucket_name: 'my-bucket',
      r2_credentials_pending: true,
    } as any)

    const canvas = makeCanvas(
      [
        { id: 'r2-node', data: { provider: 'cloudflare', cloudflareService: 'r2' } },
        { id: 'vercel-node', data: { provider: 'vercel', label: 'Storefront App' } },
      ],
      [{ source: 'r2-node', target: 'vercel-node' }],
    )
    const emitEvent = vi.fn()
    const ctx: Record<string, string> = {}
    await do_.executeStep(makeR2Step(), ctx, 'user-1', 'My Project', undefined, undefined, emitEvent, canvas)

    expect(emitEvent).toHaveBeenCalledWith(
      'Warning',
      expect.objectContaining({
        nodeId: 'r2-node',
        message: expect.stringContaining('Storefront App'),
      }),
      'R2CredentialsPending',
    )
    // Must not fall back to the old hardcoded "Vercel" wording when a real label exists.
    const call = emitEvent.mock.calls.find((c) => c[2] === 'R2CredentialsPending')
    expect(call?.[1].message).not.toMatch(/your Vercel project/)
  })

  it('R2 -> Vercel edge with no label on target node -> falls back to "Vercel" without crashing', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('cf-user-token')
    vi.mocked(getAccountId).mockResolvedValue('cf-account-id')
    vi.mocked(provisionR2).mockResolvedValue({
      r2_bucket_name: 'my-bucket',
      r2_credentials_pending: true,
    } as any)

    const canvas = makeCanvas(
      [
        { id: 'r2-node', data: { provider: 'cloudflare', cloudflareService: 'r2' } },
        { id: 'vercel-node', data: { provider: 'vercel' } },
      ],
      [{ source: 'r2-node', target: 'vercel-node' }],
    )
    const emitEvent = vi.fn()
    const ctx: Record<string, string> = {}
    await do_.executeStep(makeR2Step(), ctx, 'user-1', 'My Project', undefined, undefined, emitEvent, canvas)

    expect(emitEvent).toHaveBeenCalledWith(
      'Warning',
      expect.objectContaining({
        message: expect.stringContaining('your Vercel project'),
      }),
      'R2CredentialsPending',
    )
  })

  it('r2_credentials_pending: false -> never emits the warning regardless of edges', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('cf-user-token')
    vi.mocked(getAccountId).mockResolvedValue('cf-account-id')
    vi.mocked(provisionR2).mockResolvedValue({
      r2_bucket_name: 'my-bucket',
      r2_credentials_pending: false,
    } as any)

    const canvas = makeCanvas(
      [
        { id: 'r2-node', data: { provider: 'cloudflare', cloudflareService: 'r2' } },
        { id: 'vercel-node', data: { provider: 'vercel', label: 'Storefront App' } },
      ],
      [{ source: 'r2-node', target: 'vercel-node' }],
    )
    const emitEvent = vi.fn()
    const ctx: Record<string, string> = {}
    await do_.executeStep(makeR2Step(), ctx, 'user-1', 'My Project', undefined, undefined, emitEvent, canvas)

    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('missing canvas (undefined) -> does not crash and suppresses the warning', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('cf-user-token')
    vi.mocked(getAccountId).mockResolvedValue('cf-account-id')
    vi.mocked(provisionR2).mockResolvedValue({
      r2_bucket_name: 'my-bucket',
      r2_credentials_pending: true,
    } as any)

    const emitEvent = vi.fn()
    const ctx: Record<string, string> = {}
    await expect(
      do_.executeStep(makeR2Step(), ctx, 'user-1', 'My Project', undefined, undefined, emitEvent, undefined),
    ).resolves.not.toThrow()

    expect(emitEvent).not.toHaveBeenCalled()
  })
})

// --- SB_KEY_MAP multi-Supabase override reaches both
// NEXT_PUBLIC_* and VITE_* naming conventions, not just Next.js's ---
describe('ProvisionerDO.executeStep — SB_KEY_MAP multi-Supabase override (framework-aware names)', () => {
  function makeInjectStep(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      service: 'vercel',
      action: 'inject',
      params: { connectedSupabaseNodeId: 'node-2', ...overrides },
      nodeId: 'node-1',
      nodeLabel: 'Vercel App',
    } as any
  }

  it('overrides both NEXT_PUBLIC_SUPABASE_* and VITE_SUPABASE_* from the node-specific ctx keys', async () => {
    const do_ = makeDO()
    const ctx: Record<string, string> = {
      supabase_url_node_2: 'https://node2.supabase.co',
      supabase_anon_key_node_2: 'node2-anon-key',
      supabase_service_role_node_2: 'node2-service-role',
    }
    const result = await do_.executeStep(
      makeInjectStep({ connectedSupabaseNodeId: 'node_2' }),
      ctx,
      'user-1',
      'My Project',
    )

    expect(result.NEXT_PUBLIC_SUPABASE_URL).toBe('https://node2.supabase.co')
    expect(result.VITE_SUPABASE_URL).toBe('https://node2.supabase.co')
    expect(result.SUPABASE_URL).toBe('https://node2.supabase.co')

    expect(result.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('node2-anon-key')
    expect(result.VITE_SUPABASE_ANON_KEY).toBe('node2-anon-key')
    expect(result.SUPABASE_ANON_KEY).toBe('node2-anon-key')

    expect(result.SUPABASE_SERVICE_ROLE_KEY).toBe('node2-service-role')
  })

  it('does not set VITE_/NEXT_PUBLIC_ keys when no node-specific ctx values exist', async () => {
    const do_ = makeDO()
    const ctx: Record<string, string> = {}
    const result = await do_.executeStep(
      makeInjectStep({ connectedSupabaseNodeId: 'node_missing' }),
      ctx,
      'user-1',
      'My Project',
    )
    expect(result.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined()
    expect(result.VITE_SUPABASE_URL).toBeUndefined()
  })
})

// --- github_run_id/github_run_url threaded into providerRefs +
// StepCompleted, and must survive updateStepOutput's SENSITIVE_KEYS denylist ---
describe('ProvisionerDO.runWithSession — cloudflare-workers github_run_id/github_run_url propagation', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let deploymentPostBody: any = null

  // Same generic Supabase responder pattern as the preflight describe block above,
  // extended to also capture the project_deployments POST body (where providerRefs
  // ultimately lands) and to satisfy provisioning_sessions PATCH (updateStepOutput)
  // plus the misc env-node-state/canvas-patch calls runWithSession makes post-step.
  function stubSupabase() {
    deploymentPostBody = null
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/rest/v1/stacks?id=eq.')) {
        return new Response(
          JSON.stringify([{ project_id: 'project-1', environment_id: 'env-1' }]),
          { status: 200 },
        )
      }
      if (u.includes('/rest/v1/projects?id=eq.')) {
        return new Response(
          JSON.stringify([{ canvas: { nodes: [], edges: [] } }]),
          { status: 200 },
        )
      }
      if (u.includes('/rest/v1/project_deployments')) {
        deploymentPostBody = init?.body ? JSON.parse(String(init.body)) : null
        return new Response(null, { status: 201 })
      }
      // Vercel preflight (assertVercelGitHubLinked) — satisfy with a linked namespace
      // so the vercel-only comparison test can reach the step loop.
      if (u.includes('/v1/integrations/git-namespaces')) {
        return new Response(JSON.stringify({ namespaces: [{ slug: 'acme' }] }), { status: 200 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  function makeStack() {
    return {
      projectName: 'My App',
      steps: [
        {
          service: 'cloudflare-workers',
          action: 'provision',
          params: { existing_repo: 'https://github.com/acme/widgets' },
          nodeId: 'node-1',
          nodeLabel: 'Workers',
        },
      ],
    }
  }

  it('carries github_run_id/github_run_url into the StepCompleted event output and into providerRefs', async () => {
    stubSupabase()
    const do_ = makeDO()
    vi.spyOn(do_, 'updateSession').mockResolvedValue(undefined)
    vi.spyOn(do_, 'updateStatus').mockResolvedValue(undefined)
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('fake-token')

    const stepResult = {
      cloudflare_account_id: 'cf-account-id',
      cloudflare_worker_name: 'acme-worker',
      cloudflare_worker_url: 'https://acme-worker.acme-sub.workers.dev',
      CLOUDFLARE_ACCOUNT_ID: 'cf-account-id',
      CLOUDFLARE_WORKER_NAME: 'acme-worker',
      CLOUDFLARE_WORKER_URL: 'https://acme-worker.acme-sub.workers.dev',
      github_run_id: '555',
      github_run_url: 'https://github.com/acme/widgets/actions/runs/555',
    }
    vi.spyOn(do_, 'executeStep' as any).mockResolvedValue(stepResult)

    // StepCompleted (event + provisioning_sessions write + success log) is
    // now folded into a single stepCompleteRpc() call — capture it so we can
    // inspect the event payload directly.
    const rpcSpy = vi.spyOn(do_, 'stepCompleteRpc' as any).mockResolvedValue(undefined)

    await do_.runWithSession('sess-1', 'stack-1', 'user-1', makeStack())

    // (a) StepCompleted event payload's output contains github_run_id/github_run_url —
    // proves the "entire result object, not a hand-picked subset" claim holds.
    expect(rpcSpy).toHaveBeenCalled()
    const stepCompletedPayload = rpcSpy.mock.calls[0][5] as any
    expect(stepCompletedPayload.output.github_run_id).toBe('555')
    expect(stepCompletedPayload.output.github_run_url).toBe(
      'https://github.com/acme/widgets/actions/runs/555',
    )

    // (b) providerRefs for node-1 (persisted into project_deployments.provider_refs)
    // contains matching runId/runUrl.
    expect(deploymentPostBody).not.toBeNull()
    expect(deploymentPostBody.provider_refs['node-1']).toMatchObject({
      service: 'cloudflare-workers',
      workerName: 'acme-worker',
      runId: '555',
      runUrl: 'https://github.com/acme/widgets/actions/runs/555',
    })
  })

  it('does not add runId/runUrl to a vercel step\'s providerRefs (only cloudflare-workers gains the new fields)', async () => {
    stubSupabase()
    const do_ = makeDO()
    vi.spyOn(do_, 'updateSession').mockResolvedValue(undefined)
    vi.spyOn(do_, 'updateStatus').mockResolvedValue(undefined)
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('fake-token')
    vi.spyOn(do_, '_emit' as any).mockResolvedValue(undefined)
    vi.spyOn(do_, 'executeStep' as any).mockResolvedValue({
      vercel_project_id: 'vp-1',
      vercel_deployment_id: 'vd-1',
    })

    const stack = {
      projectName: 'My App',
      steps: [
        {
          service: 'vercel',
          action: 'provision',
          params: {},
          nodeId: 'node-1',
          nodeLabel: 'Vercel',
        },
      ],
    }

    await do_.runWithSession('sess-1', 'stack-1', 'user-1', stack)

    expect(deploymentPostBody).not.toBeNull()
    const ref = deploymentPostBody.provider_refs['node-1']
    expect(ref).toMatchObject({ service: 'vercel', projectId: 'vp-1', deploymentId: 'vd-1' })
    expect(ref.runId).toBeUndefined()
    expect(ref.runUrl).toBeUndefined()
  })
})

// --- updateStep's output SENSITIVE_KEYS denylist must not strip
// github_run_id/github_run_url — otherwise the MCP round-trip (provisioning_sessions.steps)
// would silently lose this data even though providerRefs/StepCompleted carry it.
// (updateStepOutput was folded into updateStep's optional `output` param to cut
// a subrequest per step.) ---
describe('ProvisionerDO.updateStep output — github_run_id/github_run_url survive the SENSITIVE_KEYS denylist', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('persists github_run_id/github_run_url unchanged into provisioning_sessions.steps', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const do_ = makeDO()
    do_.cachedSteps = [{ status: 'running' }]

    await do_.updateStep('sess-1', 0, 'success', undefined, {
      cloudflare_worker_name: 'acme-worker',
      github_run_id: '555',
      github_run_url: 'https://github.com/acme/widgets/actions/runs/555',
    })

    expect(do_.cachedSteps[0].output.github_run_id).toBe('555')
    expect(do_.cachedSteps[0].output.github_run_url).toBe(
      'https://github.com/acme/widgets/actions/runs/555',
    )
    const persistedBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(persistedBody.steps[0].output.github_run_id).toBe('555')
    expect(persistedBody.steps[0].output.github_run_url).toBe(
      'https://github.com/acme/widgets/actions/runs/555',
    )
  })
})

// ── ProvisionerDO secret redaction (M2 security fix) ────────────────────────
// `log()` writes to client-readable `deployment_logs.message`; `auditRedacted()`
// writes to client-readable `user_audit_log` via `auditLog()`. Both must scrub
// any secret value (decrypted OAuth tokens, injected env values, generated
// credentials) that a provider might echo back inside a free-text error.
describe('ProvisionerDO secret redaction (M2)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  describe('log()', () => {
    it('redacts a known secret value out of the message before writing', async () => {
      const do_ = makeDO()
      do_.secretValues.add('sk-super-secret-token')

      await do_.log(
        'stack-1',
        'session-1',
        'error',
        'vercel',
        'Deploy failed: invalid token sk-super-secret-token',
      )

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      expect(body.message).toBe('Deploy failed: invalid token [REDACTED]')
      expect(body.message).not.toContain('sk-super-secret-token')
    })

    it('leaves the message untouched when no secret values are known', async () => {
      const do_ = makeDO()

      await do_.log('stack-1', 'session-1', 'info', 'vercel', 'Vercel provisioned successfully')

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      expect(body.message).toBe('Vercel provisioned successfully')
    })
  })

  describe('auditRedacted()', () => {
    it('redacts a secret value inside a string `error` field', async () => {
      const do_ = makeDO()
      do_.secretValues.add('sk-super-secret-token')

      do_.auditRedacted('user-1', 'deploy_failed', {
        stackId: 'stack-1',
        error: 'invalid token sk-super-secret-token',
      })
      await Promise.resolve() // auditLog is fire-and-forget

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      expect(body.metadata.error).toBe('invalid token [REDACTED]')
    })

    it('redacts secret values inside each entry of an `errors` array', async () => {
      const do_ = makeDO()
      do_.secretValues.add('db-pass-xyz')

      do_.auditRedacted('user-1', 'deploy_teardown', {
        stackId: 'stack-1',
        removed: 1,
        errors: ['supabase: failed with db-pass-xyz', 'vercel: ok'],
      })
      await Promise.resolve()

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      expect(body.metadata.errors).toEqual([
        'supabase: failed with [REDACTED]',
        'vercel: ok',
      ])
    })

    it('passes metadata through unchanged when no secret values are known', async () => {
      const do_ = makeDO()

      do_.auditRedacted('user-1', 'deploy_completed', {
        stackId: 'stack-1',
        nodeCount: 3,
      })
      await Promise.resolve()

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      expect(body.metadata).toEqual({ stackId: 'stack-1', nodeCount: 3 })
    })

    it('redacts a secret value under an arbitrary free-text field name, not just error/errors', async () => {
      const do_ = makeDO()
      do_.secretValues.add('sk-super-secret-token')

      do_.auditRedacted('user-1', 'deploy_failed', {
        stackId: 'stack-1',
        detail: 'root cause: sk-super-secret-token',
      })
      await Promise.resolve()

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      expect(body.metadata.detail).toBe('root cause: [REDACTED]')
    })

    it('recurses into nested objects when redacting', async () => {
      const do_ = makeDO()
      do_.secretValues.add('sk-super-secret-token')

      do_.auditRedacted('user-1', 'deploy_failed', {
        stackId: 'stack-1',
        context: { nested: { note: 'saw sk-super-secret-token in response' } },
      })
      await Promise.resolve()

      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      expect(body.metadata.context.nested.note).toBe('saw [REDACTED] in response')
    })
  })

  describe('secretValues precision (over-broad redaction fix)', () => {
    it('only tracks step-output values whose key looks secret-shaped, not benign identifiers', async () => {
      fetchMock = vi.fn(async (url: string) => {
        const u = String(url)
        if (u.includes('/rest/v1/stacks?id=eq.')) {
          return new Response(JSON.stringify([{ project_id: 'project-1', environment_id: 'env-1' }]), { status: 200 })
        }
        if (u.includes('/rest/v1/projects?id=eq.')) {
          return new Response(JSON.stringify([{ canvas: { nodes: [], edges: [] } }]), { status: 200 })
        }
        return new Response(JSON.stringify([]), { status: 200 })
      })
      vi.stubGlobal('fetch', fetchMock)

      const do_ = makeDO()
      vi.spyOn(do_, 'updateSession').mockResolvedValue(undefined)
      vi.spyOn(do_, 'updateStatus').mockResolvedValue(undefined)
      vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('fake-token')
      vi.spyOn(do_, '_emit' as any).mockResolvedValue(undefined)
      vi.spyOn(do_, 'executeStep' as any).mockResolvedValue({
        supabase_url: 'https://abc123.supabase.co',
        supabase_service_role: 'real-service-role-secret',
        cloudflare_worker_name: 'my-worker',
      })

      await do_.runWithSession('sess-1', 'stack-1', 'user-1', {
        projectName: 'My App',
        steps: [{ service: 'supabase', action: 'provision', params: {}, nodeId: 'node-1', nodeLabel: 'Supabase' }],
      })

      expect(do_.secretValues.has('real-service-role-secret')).toBe(true)
      expect(do_.secretValues.has('https://abc123.supabase.co')).toBe(false)
      expect(do_.secretValues.has('my-worker')).toBe(false)
    })
  })
})

describe('ProvisionerDO.recordCreatedResource (in-memory teardown ledger)', () => {
  it('records a created vercel resource with its project id', () => {
    const doInst = makeDO()
    doInst.createdResources = []
    doInst.recordCreatedResource(
      { service: 'vercel', action: 'provision', params: {}, nodeId: 'n2' },
      { vercel_project_id: 'prj_abc', vercel_project_url: 'https://x.vercel.app' },
    )
    expect(doInst.createdResources).toEqual([
      { service: 'vercel', nodeId: 'n2', resourceId: 'prj_abc', created: true },
    ])
  })

  it('does NOT record inject/redeploy/configure steps (nothing was created)', () => {
    const doInst = makeDO()
    doInst.createdResources = []
    doInst.recordCreatedResource(
      { service: 'vercel', action: 'redeploy', params: {}, nodeId: 'n2' },
      { vercel_project_id: 'prj_reused' },
    )
    doInst.recordCreatedResource(
      { service: 'cloudflare-workers', action: 'inject', params: {}, nodeId: 'n3' },
      {},
    )
    expect(doInst.createdResources).toEqual([])
  })

  it('does NOT record when there is no resource id in the output', () => {
    const doInst = makeDO()
    doInst.createdResources = []
    doInst.recordCreatedResource(
      { service: 'supabase', action: 'provision', params: {}, nodeId: 'n1' },
      { some_other_field: 'x' },
    )
    expect(doInst.createdResources).toEqual([])
  })
})

describe('ProvisionerDO._emit durable retry', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('scheduler', { wait: vi.fn(async () => {}) })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('retries a durable emit up to 3× on failure, then gives up without throwing', async () => {
    fetchMock.mockResolvedValue(new Response('err', { status: 500 }))
    const doInst = makeDO()
    await expect(
      doInst._emit('sess', 'stack', 'StepCompleted', { stepIndex: 0 }, 'StepCompleted:0', { durable: true }),
    ).resolves.toBeUndefined()
    // provisioning_events POST attempted 3×
    const eventPosts = fetchMock.mock.calls.filter(([url]) => String(url).includes('provisioning_events'))
    expect(eventPosts.length).toBe(3)
  })

  it('a non-durable emit attempts the write once and swallows failure', async () => {
    fetchMock.mockResolvedValue(new Response('err', { status: 500 }))
    const doInst = makeDO()
    await expect(doInst._emit('sess', 'stack', 'StepStarted', { stepIndex: 0 })).resolves.toBeUndefined()
    const eventPosts = fetchMock.mock.calls.filter(([url]) => String(url).includes('provisioning_events'))
    expect(eventPosts.length).toBe(1)
  })
})

describe('ProvisionerDO.compensateTeardown — in-memory ledger', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.clearAllMocks()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('tears down resources from the in-memory ledger without touching the event log', async () => {
    const doInst = makeDO()
    doInst.createdResources = [
      { service: 'vercel', nodeId: 'n2', resourceId: 'prj_abc', created: true },
    ]
    vi.spyOn(doInst, 'getUserToken').mockResolvedValue('vercel-token')
    await doInst.compensateTeardown('stack-1', 'user-1', 'sess-1')
    expect(deprovisionVercel).toHaveBeenCalledWith('vercel-token', { vercel_project_id: 'prj_abc' })
    expect(getProvisionedResources).not.toHaveBeenCalled()
  })

  it('falls back to the event log when the in-memory ledger is empty', async () => {
    const doInst = makeDO()
    doInst.createdResources = []
    vi.mocked(getProvisionedResources).mockResolvedValue([
      { service: 'vercel', nodeId: 'n2', resourceId: 'prj_evt', created: true } as any,
    ])
    vi.spyOn(doInst, 'getUserToken').mockResolvedValue('vercel-token')
    await doInst.compensateTeardown('stack-1', 'user-1', 'sess-1')
    expect(getProvisionedResources).toHaveBeenCalledWith(doInst.env, 'stack-1')
    expect(deprovisionVercel).toHaveBeenCalledWith('vercel-token', { vercel_project_id: 'prj_evt' })
  })
})

describe('ProvisionerDO timeout path triggers teardown', () => {
  it('the top-level timeout catch tears down created resources', async () => {
    const doInst = makeDO()
    doInst.createdResources = [
      { service: 'vercel', nodeId: 'n2', resourceId: 'prj_timeout', created: true },
    ]
    doInst.timedOut = true
    const spy = vi.spyOn(doInst, 'compensateTeardown').mockResolvedValue(undefined)
    // Exercise the extracted timeout-cleanup helper directly (see Step 6).
    await doInst.handleTimeoutCleanup('sess-1', 'stack-1', 'user-1')
    expect(spy).toHaveBeenCalledWith('stack-1', 'user-1', 'sess-1')
  })
})

describe('ProvisionerDO.alarm — watchdog teardown', () => {
  it('tears down provisioned resources from the event log when the watchdog fires', async () => {
    const doInst = makeDO()
    // Fresh isolate: no in-memory ledger.
    doInst.createdResources = []
    const storageData: Record<string, any> = {
      watchdog: { sessionId: 'sess-1', stackId: 'stack-1', workflowId: 'proj-1', userId: 'user-1' },
    }
    doInst.state = {
      storage: {
        get: async (k: string) => storageData[k] ?? null,
        put: async () => {},
        delete: async (k: string) => { delete storageData[k] },
        deleteAlarm: async () => {},
        setAlarm: async () => {},
      },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })))
    const spy = vi.spyOn(doInst, 'compensateTeardown').mockResolvedValue(undefined)
    await doInst.alarm()
    expect(spy).toHaveBeenCalledWith('stack-1', 'user-1', 'sess-1')
    vi.unstubAllGlobals()
  })

  it('does not attempt teardown when the watchdog has no userId (legacy row)', async () => {
    const doInst = makeDO()
    const storageData: Record<string, any> = {
      watchdog: { sessionId: 'sess-1', stackId: 'stack-1', workflowId: 'proj-1' },
    }
    doInst.state = {
      storage: {
        get: async (k: string) => storageData[k] ?? null,
        put: async () => {}, delete: async () => {}, deleteAlarm: async () => {}, setAlarm: async () => {},
      },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })))
    const spy = vi.spyOn(doInst, 'compensateTeardown').mockResolvedValue(undefined)
    await doInst.alarm()
    expect(spy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  // A deploy whose every step succeeded but whose finalize terminal-write never
  // landed (DB blip / eviction right after the last step) must recover as
  // SUCCESS — not be torn down and reported as a spurious failure.
  it('recovers as SUCCESS (no teardown) when every step already succeeded', async () => {
    const doInst = makeDO()
    const storageData: Record<string, any> = {
      watchdog: { sessionId: 'sess-1', stackId: 'stack-1', workflowId: 'proj-1', userId: 'user-1' },
    }
    doInst.state = {
      storage: {
        get: async (k: string) => storageData[k] ?? null,
        put: async () => {}, delete: async (k: string) => { delete storageData[k] }, deleteAlarm: async () => {}, setAlarm: async () => {},
      },
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/provisioning_sessions?id=eq.sess-1') && String(url).includes('select=steps'))
        return new Response(JSON.stringify([{ steps: [{ status: 'success' }, { status: 'success' }] }]), { status: 200 })
      return new Response('[]', { status: 200 })
    }))
    const teardown = vi.spyOn(doInst, 'compensateTeardown').mockResolvedValue(undefined)
    const updateSession = vi.spyOn(doInst, 'updateSession').mockResolvedValue(undefined)
    const updateStatus = vi.spyOn(doInst, 'updateStatus').mockResolvedValue(undefined)
    await doInst.alarm()
    expect(teardown).not.toHaveBeenCalled()
    expect(updateSession).toHaveBeenCalledWith('sess-1', 'success')
    expect(updateStatus).toHaveBeenCalledWith('stack-1', 'ready')
    vi.unstubAllGlobals()
  })

  it('recovers as FAILED (with teardown) when a step did not succeed', async () => {
    const doInst = makeDO()
    const storageData: Record<string, any> = {
      watchdog: { sessionId: 'sess-1', stackId: 'stack-1', workflowId: 'proj-1', userId: 'user-1' },
    }
    doInst.state = {
      storage: {
        get: async (k: string) => storageData[k] ?? null,
        put: async () => {}, delete: async (k: string) => { delete storageData[k] }, deleteAlarm: async () => {}, setAlarm: async () => {},
      },
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/provisioning_sessions?id=eq.sess-1') && String(url).includes('select=steps'))
        return new Response(JSON.stringify([{ steps: [{ status: 'success' }, { status: 'running' }] }]), { status: 200 })
      return new Response('[]', { status: 200 })
    }))
    const teardown = vi.spyOn(doInst, 'compensateTeardown').mockResolvedValue(undefined)
    const updateSession = vi.spyOn(doInst, 'updateSession').mockResolvedValue(undefined)
    await doInst.alarm()
    expect(teardown).toHaveBeenCalledWith('stack-1', 'user-1', 'sess-1')
    expect(updateSession).toHaveBeenCalledWith('sess-1', 'failed', expect.any(String))
    vi.unstubAllGlobals()
  })
})

describe('ProvisionerDO.fetch — cancel action terminates the session', () => {
  const STACK_ID = '40231d74-c4c2-4473-b57e-4ad44267830b'

  afterEach(() => vi.unstubAllGlobals())

  function makeCancelDO(stackStatus: string) {
    const doInst = makeDO()
    const storageData: Record<string, any> = {
      watchdog: { sessionId: 'sess-1', stackId: STACK_ID, workflowId: 'proj-1', userId: 'user-1' },
    }
    doInst.state = {
      storage: {
        get: async (k: string) => storageData[k] ?? null,
        put: async (k: string, v: any) => { storageData[k] = v },
        delete: async (k: string) => { delete storageData[k] },
        deleteAlarm: async () => {},
        setAlarm: async () => {},
      },
      waitUntil: () => {},
    }
    // sb() → global fetch: the only fetch the cancel handler makes is the
    // stacks status read; return the requested status.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [{ status: stackStatus }],
        text: async () => '',
      }),
    )
    return doInst
  }

  function cancelRequest() {
    return new Request('https://do/cancel', {
      method: 'POST',
      headers: { 'X-Internal-Token': 'tok' },
      body: JSON.stringify({ stackId: STACK_ID }),
    })
  }

  // Regression: a cancel that lands after the last provision step (so the in-loop
  // cancel check never runs) used to write stacks='error' but leave the session
  // row at status='running'/finished_at=null with the watchdog+alarm deleted —
  // nothing ever recovered it, so the frontend polled "running" forever and
  // config-only nodes (github) stayed DRAFT. The handler must now write a terminal
  // session status itself.
  it('writes a terminal session status (not left at "running")', async () => {
    const doInst = makeCancelDO('provisioning')
    const updateStatusSpy = vi.spyOn(doInst, 'updateStatus').mockResolvedValue(undefined)
    const updateSessionSpy = vi.spyOn(doInst, 'updateSession').mockResolvedValue(undefined)
    const updateProjectStatusSpy = vi.spyOn(doInst, 'updateProjectStatus').mockResolvedValue(undefined)

    const res = await doInst.fetch(cancelRequest())

    expect(res.status).toBe(200)
    expect(updateStatusSpy).toHaveBeenCalledWith(STACK_ID, 'error')
    // projects.status must be marked too (watchdog.workflowId === projectId), so
    // the workflow card doesn't stay stuck on a stale 'active'/'draft'.
    expect(updateProjectStatusSpy).toHaveBeenCalledWith('proj-1', 'error')
    const terminalCall = updateSessionSpy.mock.calls.find(
      (c: any[]) => c[0] === 'sess-1' && (c[1] === 'cancelled' || c[1] === 'failed'),
    )
    expect(terminalCall).toBeTruthy()
  })

  it('does not clobber a session whose stack already reached "ready"', async () => {
    const doInst = makeCancelDO('ready')
    const updateStatusSpy = vi.spyOn(doInst, 'updateStatus').mockResolvedValue(undefined)
    const updateSessionSpy = vi.spyOn(doInst, 'updateSession').mockResolvedValue(undefined)
    const updateProjectStatusSpy = vi.spyOn(doInst, 'updateProjectStatus').mockResolvedValue(undefined)

    const res = await doInst.fetch(cancelRequest())

    expect(res.status).toBe(200)
    expect(updateStatusSpy).not.toHaveBeenCalled()
    expect(updateSessionSpy).not.toHaveBeenCalled()
    expect(updateProjectStatusSpy).not.toHaveBeenCalled()
  })

  // Gap A: a cross-isolate cancel has no in-memory activeSession, and the
  // watchdog row may lack sessionId — the handler must still resolve the stack's
  // running session from the DB and terminalize it, else it's stranded at
  // 'running' forever (the real-world "deployment never finishes" bug).
  it('resolves the running session from the DB when memory + watchdog lack it', async () => {
    const doInst = makeDO()
    // watchdog present but WITHOUT sessionId; no in-memory activeSession
    const storageData: Record<string, any> = {
      watchdog: { stackId: STACK_ID, workflowId: 'proj-1', userId: 'user-1' },
    }
    doInst.state = {
      storage: {
        get: async (k: string) => storageData[k] ?? null,
        put: async () => {}, delete: async () => {}, deleteAlarm: async () => {}, setAlarm: async () => {},
      },
      waitUntil: () => {},
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/stacks?id=eq.') && u.includes('select=status'))
        return { ok: true, status: 200, json: async () => [{ status: 'provisioning' }], text: async () => '' } as any
      if (u.includes('/provisioning_sessions?stack_id=eq.') && u.includes('status=eq.running'))
        return { ok: true, status: 200, json: async () => [{ id: 'sess-from-db' }], text: async () => '' } as any
      return { ok: true, status: 200, json: async () => [], text: async () => '' } as any
    }))
    const updateSessionSpy = vi.spyOn(doInst, 'updateSession').mockResolvedValue(undefined)
    vi.spyOn(doInst, 'updateStatus').mockResolvedValue(undefined)
    vi.spyOn(doInst, 'updateProjectStatus').mockResolvedValue(undefined)

    const res = await doInst.fetch(cancelRequest())

    expect(res.status).toBe(200)
    expect(updateSessionSpy).toHaveBeenCalledWith('sess-from-db', 'cancelled', expect.any(String))
  })

  it('also clears any pending stepLoop:<sessionId> state', async () => {
    const doInst = makeCancelDO('provisioning')
    const loop = {
      sessionId: 'sess-1', stackId: STACK_ID, userId: 'user-1', // sessionId matches makeCancelDO's default watchdog.sessionId
      projectId: 'proj-1', environmentId: null,
      stack: { projectName: 'p', steps: [] },
      ctx: {}, providerRefs: {}, canvasSnapshot: {}, desiredEnvKeysMap: {},
      completedStepIndices: [], completedOutputByIndex: [], useEvents: false,
      nextStepIndex: 0, sessionStartedAt: Date.now(), deployStartedAt: Date.now(),
    }
    await (doInst as any).saveStepLoopState(loop)
    await doInst.fetch(cancelRequest())
    const stillThere = await (doInst as any).loadStepLoopState(loop.sessionId)
    expect(stillThere).toBeNull()
  })
})

// ── getUserToken — expired credential handling (H4) ──────────────────────────
// A token with expires_at in the past that cannot be refreshed must NOT be
// returned for use — the step would fire a costly API call that 401s opaquely.
describe('ProvisionerDO.getUserToken — expired credentials', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const connRow = (over: Record<string, unknown>) =>
    new Response(
      JSON.stringify([
        { access_token_enc: 'enc', refresh_token_enc: null, expires_at: null, ...over },
      ]),
      { status: 200 },
    )
  const past = () => new Date(Date.now() - 60_000).toISOString()

  it('throws an actionable error when expired with no refresh token', async () => {
    fetchMock.mockResolvedValue(connRow({ expires_at: past() }))
    const do_ = makeDO()
    await expect(do_.getUserToken('u1', 'vercel')).rejects.toThrow(
      /vercel connection has expired/i,
    )
  })

  it('throws when expired and the refresh attempt yields no new token', async () => {
    fetchMock.mockResolvedValue(connRow({ expires_at: past(), refresh_token_enc: 'renc' }))
    const do_ = makeDO()
    vi.spyOn(do_, 'refreshToken' as any).mockResolvedValue(null)
    await expect(do_.getUserToken('u1', 'cloudflare')).rejects.toThrow(
      /cloudflare connection has expired/i,
    )
  })

  it('returns the refreshed token when refresh succeeds', async () => {
    fetchMock.mockResolvedValue(connRow({ expires_at: past(), refresh_token_enc: 'renc' }))
    const do_ = makeDO()
    vi.spyOn(do_, 'refreshToken' as any).mockResolvedValue('fresh-token')
    await expect(do_.getUserToken('u1', 'supabase')).resolves.toBe('fresh-token')
  })
})

// --- Live-authoritative flip: redeploy no longer pushes the
// canvas seed's columns into the live DB via applySupabaseAlterColumns (removed
// entirely — see connectors/supabase.ts). Instead the configure step only
// creates brand-new tables (CREATE TABLE IF NOT EXISTS) and then reconciles the
// canvas snapshot from the live schema via refreshNodeSnapshot, non-fatally. ---
describe('ProvisionerDO.executeStep — supabase configure (redeploy) — live-authoritative', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let queryBodies: string[]

  beforeEach(() => {
    queryBodies = []
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/v1/projects/') && u.includes('/database/query')) {
        const body = init?.body ? JSON.parse(String(init.body)) : {}
        queryBodies.push(String(body.query ?? ''))
        return new Response(JSON.stringify({}), { status: 200 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(refreshNodeSnapshot).mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function makeStep(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      service: 'supabase',
      action: 'configure',
      nodeId: 'sb-node-1',
      nodeLabel: 'Supabase',
      params: {
        supabaseProjectRef: 'abcdefghijklmnop',
        // A seed column ("bio") absent from the live DB — under the old
        // canvas-as-authority behavior this would trigger an ALTER TABLE ADD
        // COLUMN; under live-authoritative rules it must NOT reach live at all.
        tables: [
          {
            name: 'profiles',
            columns: [{ name: 'bio', type: 'text' }],
          },
        ],
        ...overrides,
      },
    } as any
  }

  it('does not send an ALTER TABLE ADD COLUMN for a seed column absent from live (no applySupabaseAlterColumns call)', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('fake-token')

    await do_.executeStep(makeStep(), {}, 'user-1', 'My Project')

    // applySupabaseSchema legitimately emits "ALTER TABLE ... ENABLE ROW LEVEL
    // SECURITY" as part of CREATE TABLE IF NOT EXISTS DDL — that's fine. What
    // must NOT appear is an ADD COLUMN, which only applySupabaseAlterColumns
    // (now deleted) used to emit for pending seed columns.
    const addColumnCalls = queryBodies.filter((q) => /ADD COLUMN/i.test(q))
    expect(addColumnCalls).toHaveLength(0)
  })

  it('still applies schema via applySupabaseSchema (CREATE TABLE IF NOT EXISTS for brand-new tables)', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('fake-token')

    await do_.executeStep(makeStep(), {}, 'user-1', 'My Project')

    const createCalls = queryBodies.filter((q) => /CREATE TABLE IF NOT EXISTS/i.test(q))
    expect(createCalls.length).toBeGreaterThan(0)
  })

  it('does not call refreshNodeSnapshot during deploy (deferred to Database-page load reconciliation, see 3fdaebde)', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('fake-token')

    await do_.executeStep(makeStep(), {}, 'user-1', 'My Project')

    // Synchronous snapshot refresh was removed from the deploy critical path —
    // introspectSchema's up to 7 parallel Management API calls made this step
    // the likeliest one to blow the Workers Free plan's 50 subrequest/invocation
    // cap on a multi-step deploy. The Database page's GET .../schema route
    // self-heals any stale snapshot on next view instead.
    expect(refreshNodeSnapshot).not.toHaveBeenCalled()
  })

  it('is non-fatal when the seed carries an editor-unsupported live type (inet)', async () => {
    // Once a live-introspected schema is written back into node.data.tables
    // (via the Database page's load-time reconciliation), the redeploy seed
    // can contain types the editor DDL builder rejects (e.g. a raw-SQL `inet`
    // column) — the very live types live-authoritative mode exists to
    // preserve. buildDDL throws on those. The configure step
    // must swallow that (live DB untouched, no DDL sent) rather than fail the
    // deploy.
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('fake-token')

    const step = makeStep({
      tables: [{ name: 'events', columns: [{ name: 'source_ip', type: 'inet' }] }],
    })

    await expect(
      do_.executeStep(step, {}, 'user-1', 'My Project'),
    ).resolves.toBeDefined()

    // buildDDL threw before issuing any query — nothing reached the live DB.
    const createCalls = queryBodies.filter((q) => /CREATE TABLE IF NOT EXISTS/i.test(q))
    expect(createCalls).toHaveLength(0)
  })

  it('the step result no longer contains applied_columns_json', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('fake-token')

    const result = await do_.executeStep(makeStep(), {}, 'user-1', 'My Project')

    expect(result).not.toHaveProperty('applied_columns_json')
  })
})

// --- Fresh Supabase provision no longer produces applied_columns_json
// (the "mark all authored columns as applied" bookkeeping is retired), while
// first-provision schema application itself is unchanged. ---
describe('ProvisionerDO.executeStep — supabase provision (fresh) — no applied_columns_json', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      // Most-specific patterns first — /v1/projects is a prefix of several
      // other endpoints (status poll, api-keys, database/query), so ordering
      // matters here.
      if (u.includes('/v1/projects/') && u.includes('/api-keys')) {
        return new Response(
          JSON.stringify([
            { name: 'anon', api_key: 'anon-key' },
            { name: 'service_role', api_key: 'service-role-key' },
          ]),
          { status: 200 },
        )
      }
      if (u.includes('/database/query')) {
        return new Response(JSON.stringify({}), { status: 200 })
      }
      if (u.includes('/v1/organizations')) {
        return new Response(JSON.stringify([{ id: 'org-1', name: 'Org' }]), { status: 200 })
      }
      if (u.endsWith('/v1/projects') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ id: 'proj-1', ref: 'freshprojectref01', status: 'ACTIVE_HEALTHY' }),
          { status: 201 },
        )
      }
      if (u.endsWith('/v1/projects')) {
        // GET list (existing project lookup)
        return new Response(JSON.stringify([]), { status: 200 })
      }
      if (/\/v1\/projects\/[^/]+$/.test(u)) {
        // Status poll
        return new Response(JSON.stringify({ ref: 'freshprojectref01', status: 'ACTIVE_HEALTHY' }), { status: 200 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(refreshNodeSnapshot).mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function makeStep() {
    return {
      service: 'supabase',
      action: 'provision',
      nodeId: 'sb-node-1',
      nodeLabel: 'Supabase',
      params: {
        tables: [{ name: 'profiles', columns: [{ name: 'bio', type: 'text' }] }],
      },
    } as any
  }

  // provisionSupabase's ready-poll loop starts with a real 5s sleep even when
  // the project is immediately ACTIVE_HEALTHY (see connectors/supabase.test.ts
  // for the same pattern) — fake timers + drain microtasks + runAllTimersAsync
  // is required or the test hits vitest's 5s default timeout.
  async function runStep(do_: any) {
    vi.useFakeTimers()
    try {
      const prom = do_.executeStep(makeStep(), {}, 'user-1', 'My Project')
      for (let i = 0; i < 20; i++) await Promise.resolve()
      await vi.runAllTimersAsync()
      return await prom
    } finally {
      vi.useRealTimers()
    }
  }

  it('does not include applied_columns_json in the step result', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('fake-token')

    const result = await runStep(do_)

    expect(result).not.toHaveProperty('applied_columns_json')
  })

  it('still applies schema on first provision (non-branch path calls applySupabaseSchema)', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('fake-token')

    await runStep(do_)

    const createCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/database/query'),
    )
    expect(createCalls.length).toBeGreaterThan(0)
  })

  it('does not call refreshNodeSnapshot on fresh provision', async () => {
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('fake-token')

    await runStep(do_)

    expect(refreshNodeSnapshot).not.toHaveBeenCalled()
  })
})

describe('ProvisionerDO step-loop state persistence', () => {
  it('saveStepLoopState then loadStepLoopState round-trips the full object', async () => {
    const storageData: Record<string, any> = {}
    const do_ = new ProvisionerDO(
      {
        storage: {
          get: async (k: string) => storageData[k],
          put: async (k: string, v: any) => { storageData[k] = v },
          delete: async (k: string) => { delete storageData[k] },
          deleteAlarm: async () => {},
          setAlarm: async () => {},
        },
      } as any,
      mockEnv,
    ) as any
    const state = {
      sessionId: 'sess-1', stackId: 'stack-1', userId: 'user-1',
      projectId: 'proj-1', environmentId: 'env-1',
      stack: { projectName: 'p', steps: [] },
      ctx: { FOO: 'bar' }, providerRefs: {},
      canvasSnapshot: {}, desiredEnvKeysMap: {},
      completedStepIndices: [], completedOutputByIndex: [],
      useEvents: false, nextStepIndex: 1,
      sessionStartedAt: 1000, deployStartedAt: 1000,
    }
    await do_.saveStepLoopState(state)
    const loaded = await do_.loadStepLoopState('sess-1')
    expect(loaded).toEqual(state)
  })

  it('loadStepLoopState returns undefined when nothing was saved', async () => {
    const storageData: Record<string, any> = {}
    const do_ = new ProvisionerDO(
      {
        storage: {
          get: async (k: string) => storageData[k],
          put: async (k: string, v: any) => { storageData[k] = v },
          delete: async (k: string) => { delete storageData[k] },
          deleteAlarm: async () => {},
          setAlarm: async () => {},
        },
      } as any,
      mockEnv,
    ) as any
    const loaded = await do_.loadStepLoopState('nonexistent')
    expect(loaded).toBeUndefined()
  })

  it('clearStepLoopState removes the persisted state', async () => {
    const storageData: Record<string, any> = {}
    const do_ = new ProvisionerDO(
      {
        storage: {
          get: async (k: string) => storageData[k],
          put: async (k: string, v: any) => { storageData[k] = v },
          delete: async (k: string) => { delete storageData[k] },
          deleteAlarm: async () => {},
          setAlarm: async () => {},
        },
      } as any,
      mockEnv,
    ) as any
    await do_.saveStepLoopState({
      sessionId: 'sess-2', stackId: 's', userId: 'u', projectId: null,
      environmentId: null, stack: { projectName: 'p', steps: [] },
      ctx: {}, providerRefs: {}, canvasSnapshot: {}, desiredEnvKeysMap: {},
      completedStepIndices: [], completedOutputByIndex: [], useEvents: false,
      nextStepIndex: 0, sessionStartedAt: 0, deployStartedAt: 0,
    })
    await do_.clearStepLoopState('sess-2')
    const loaded = await do_.loadStepLoopState('sess-2')
    expect(loaded).toBeUndefined()
  })
})

function makeTwoStepLoopState(): any {
  return {
    sessionId: 'sess-loop-1', stackId: 'stack-loop-1', userId: 'user-1',
    projectId: 'proj-1', environmentId: null,
    stack: {
      projectName: 'Loop Test',
      steps: [
        { service: 'cloudflare-workers', action: 'provision', params: {}, nodeId: 'n1' },
        { service: 'vercel', action: 'provision', params: {}, nodeId: 'n2' },
      ],
    },
    ctx: {}, providerRefs: {}, canvasSnapshot: {}, desiredEnvKeysMap: {},
    completedStepIndices: [], completedOutputByIndex: [],
    useEvents: false, nextStepIndex: 0,
    sessionStartedAt: Date.now(), deployStartedAt: Date.now(),
  }
}

// Builds a stateful storage backed by a plain object, matching the pattern
// used by the existing 'ProvisionerDO.alarm — watchdog teardown' describe
// block above — the shared makeDO()/mockState combo has hardcoded no-op
// get/put, which can't round-trip saveStepLoopState -> alarm()'s
// loadStepLoopState lookup that these tests exercise.
function makeStatefulStorage(seed: Record<string, any> = {}) {
  const data: Record<string, any> = { ...seed }
  return {
    data,
    storage: {
      get: async (k: string) => data[k] ?? undefined,
      put: async (k: string, v: any) => { data[k] = v },
      delete: async (k: string) => { delete data[k] },
      deleteAlarm: async () => {},
      setAlarm: async () => {},
    },
  }
}

describe('ProvisionerDO step loop — cross-invocation continuation', () => {
  beforeEach(() => {
    // Permissive default: every sb()-backed call (mutateCachedStep's write,
    // stepCompleteRpc's rpc/step_complete POST, the new cachedSteps rehydration
    // GET in alarm()) gets a generic OK response. Individual tests override
    // with vi.spyOn where they need to assert a specific call happened.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('select=steps')) {
        return new Response(
          JSON.stringify([{ steps: [
            { name: 'cloudflare-workers', nodeId: 'n1', status: 'success' },
            { name: 'vercel', nodeId: 'n2', status: 'pending' },
          ] }]),
          { status: 200 },
        )
      }
      return new Response('[]', { status: 200 })
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('after a non-final step succeeds, schedules an alarm and does not run the next step in the same call', async () => {
    const do_ = makeDO()
    const setAlarmSpy = vi.spyOn((do_ as any).state.storage, 'setAlarm')
    vi.spyOn(do_ as any, 'executeStep').mockResolvedValueOnce({ out: '1' })
    const loop = makeTwoStepLoopState() // helper: builds a valid StepLoopState with 2 steps, nextStepIndex 0
    const result = await (do_ as any).runOneStep(loop)
    expect(result).toBe('continue')
    expect(setAlarmSpy).toHaveBeenCalledWith(expect.any(Number))
    // executeStep was called exactly once — the second step did NOT run in this invocation
    expect((do_ as any).executeStep).toHaveBeenCalledTimes(1)
  })

  it('alarm() resumes a pending step loop and runs the next step', async () => {
    const do_ = makeDO()
    const { storage } = makeStatefulStorage()
    do_.state = { storage }
    const loop = makeTwoStepLoopState()
    loop.nextStepIndex = 1 // step 0 already done, step 1 pending
    await (do_ as any).saveStepLoopState(loop)
    await storage.put('watchdog', {
      sessionId: loop.sessionId, stackId: loop.stackId,
      workflowId: loop.projectId, userId: loop.userId,
    })
    const executeStepSpy = vi.spyOn(do_ as any, 'executeStep').mockResolvedValueOnce({ out: '2' })
    await do_.alarm()
    expect(executeStepSpy).toHaveBeenCalledTimes(1)
  })

  it('alarm() falls back to existing watchdog reconciliation when no step-loop state is pending', async () => {
    const do_ = makeDO()
    const { storage } = makeStatefulStorage()
    do_.state = { storage }
    await (do_ as any).state.storage.put('watchdog', {
      sessionId: 'sess-1', stackId: 'stack-1', workflowId: 'proj-1', userId: 'user-1',
    })
    const updateSessionSpy = vi.spyOn(do_ as any, 'updateSession').mockResolvedValue(undefined)
    // no stepLoop:sess-1 key saved — falls through to today's reconciliation path
    await do_.alarm()
    expect(updateSessionSpy).toHaveBeenCalled()
  })

  it('after the final step succeeds, runOneStep returns done and clears step-loop state', async () => {
    // Uses stateful storage (see makeStatefulStorage) rather than plain
    // makeDO()'s shared no-op mock: the shared mock's get() always resolves
    // `null` regardless of whether clearStepLoopState ran, which can't
    // actually distinguish "cleared" from "never cleared" and would make
    // this assertion meaningless. With real get/put/delete backing, the
    // test genuinely exercises that runOneStep's final-step success path
    // clears the persisted stepLoop:* row instead of leaving it to a later
    // owner — the row's on-disk footprint shouldn't outlive its last step.
    const do_ = makeDO()
    const { storage } = makeStatefulStorage()
    do_.state = { storage }
    vi.spyOn(do_ as any, 'executeStep').mockResolvedValueOnce({ out: 'last' })
    const loop = makeTwoStepLoopState()
    loop.nextStepIndex = 1 // last step (index 1 of 2)
    await (do_ as any).saveStepLoopState(loop)
    const result = await (do_ as any).runOneStep(loop)
    expect(result).toBe('done')
    const stillThere = await (do_ as any).loadStepLoopState(loop.sessionId)
    expect(stillThere).toBeUndefined()
  })
})

describe('ProvisionerDO step loop — branchCtx survives cross-invocation resume', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('select=steps')) {
        return new Response(
          JSON.stringify([{ steps: [
            { name: 'cloudflare-workers', nodeId: 'n1', status: 'success' },
            { name: 'vercel', nodeId: 'n2', status: 'pending' },
          ] }]),
          { status: 200 },
        )
      }
      return new Response('[]', { status: 200 })
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Regression test for the finding: branchCtx is a per-DO-instance in-memory
  // field resolved once in runWithSession's one-time setup and read throughout
  // executeStep to derive branch-specific resource identity (branch-suffixed
  // Vercel project name, CF Workers name, R2 bucket suffix). alarm()'s resume
  // path runs on what's often a fresh isolate, where this.branchCtx is back at
  // its constructor default of `null` unless explicitly restored from the
  // persisted stepLoop state. Without the fix, a branch-environment deploy's
  // steps 1+ would silently provision with trunk naming/topology instead of
  // the correct branch-specific one.
  it('alarm() restores this.branchCtx from persisted loop state before running the next step', async () => {
    const do_ = makeDO()
    const { storage } = makeStatefulStorage()
    do_.state = { storage }
    const branchCtx = { branchKey: 'my-branch', trunkState: {} }
    const loop = { ...makeTwoStepLoopState(), branchCtx }
    loop.nextStepIndex = 1 // step 0 already done, step 1 (vercel) pending
    await (do_ as any).saveStepLoopState(loop)
    await storage.put('watchdog', {
      sessionId: loop.sessionId, stackId: loop.stackId,
      workflowId: loop.projectId, userId: loop.userId,
    })
    // Simulate a fresh isolate: this.branchCtx is back at its constructor
    // default of `null`, as it would be on a real alarm-resumed invocation
    // that lands on a cold isolate.
    ;(do_ as any).branchCtx = null

    // Capture what this.branchCtx was AT THE MOMENT executeStep would run,
    // not just its final value — a strong, real assertion that the restore
    // happens before the next step executes, not merely by the time alarm()
    // returns.
    let branchCtxSeenByExecuteStep: unknown = 'NEVER_CALLED'
    vi.spyOn(do_ as any, 'executeStep').mockImplementationOnce(async () => {
      branchCtxSeenByExecuteStep = (do_ as any).branchCtx
      return { out: '2' }
    })

    await do_.alarm()

    expect(branchCtxSeenByExecuteStep).toEqual(branchCtx)
    expect((do_ as any).branchCtx).toEqual(branchCtx)
  })
})

describe('ProvisionerDO step loop — finalize reachable from a resumed (alarm) invocation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('select=steps')) {
        return new Response(
          JSON.stringify([{ steps: [
            { name: 'cloudflare-workers', nodeId: 'n1', status: 'success' },
            { name: 'vercel', nodeId: 'n2', status: 'pending' },
          ] }]),
          { status: 200 },
        )
      }
      return new Response('[]', { status: 200 })
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('when the LAST step succeeds from within alarm(), finalizeSuccess still runs (project marked active)', async () => {
    const do_ = makeDO()
    const { storage } = makeStatefulStorage()
    do_.state = { storage }
    const loop = makeTwoStepLoopState()
    loop.nextStepIndex = 1 // resuming at the final step
    await (do_ as any).saveStepLoopState(loop)
    await (do_ as any).state.storage.put('watchdog', {
      sessionId: loop.sessionId, stackId: loop.stackId,
      workflowId: loop.projectId, userId: loop.userId,
    })
    vi.spyOn(do_ as any, 'executeStep').mockResolvedValueOnce({ out: 'last' })
    const finalizeSpy = vi.spyOn(do_ as any, 'finalizeSuccess').mockResolvedValue(undefined)
    await do_.alarm()
    expect(finalizeSpy).toHaveBeenCalledTimes(1)
    expect((finalizeSpy.mock.calls[0][0] as any).sessionId).toBe(loop.sessionId)
  })

  it('a cross-isolate resume rehydrates cachedSteps from the DB (empty in-memory cache)', async () => {
    const do_ = makeDO()
    const { storage } = makeStatefulStorage()
    do_.state = { storage }
    const loop = makeTwoStepLoopState()
    loop.nextStepIndex = 1
    await (do_ as any).saveStepLoopState(loop)
    await (do_ as any).state.storage.put('watchdog', {
      sessionId: loop.sessionId, stackId: loop.stackId,
      workflowId: loop.projectId, userId: loop.userId,
    })
    vi.spyOn(do_ as any, 'executeStep').mockResolvedValueOnce({ out: 'last' })
    vi.spyOn(do_ as any, 'finalizeSuccess').mockResolvedValue(undefined)

    await do_.alarm()

    const stepReads = vi.mocked(fetch).mock.calls.filter(([u]) => String(u).includes('select=steps'))
    expect(stepReads).toHaveLength(1)
    expect((do_ as any).cachedSteps).toHaveLength(2)
  })

  it('a same-isolate hop skips the rehydrating read — the in-memory cache is already this session', async () => {
    const do_ = makeDO()
    const { storage } = makeStatefulStorage()
    do_.state = { storage }
    const loop = makeTwoStepLoopState()
    loop.nextStepIndex = 1
    await (do_ as any).saveStepLoopState(loop)
    await (do_ as any).state.storage.put('watchdog', {
      sessionId: loop.sessionId, stackId: loop.stackId,
      workflowId: loop.projectId, userId: loop.userId,
    })
    // What the previous invocation on this isolate left behind.
    ;(do_ as any).cachedSteps = [
      { name: 'cloudflare-workers', nodeId: 'n1', status: 'success' },
      { name: 'vercel', nodeId: 'n2', status: 'pending' },
    ]
    ;(do_ as any).cachedStepsSessionId = loop.sessionId
    vi.spyOn(do_ as any, 'executeStep').mockResolvedValueOnce({ out: 'last' })
    vi.spyOn(do_ as any, 'finalizeSuccess').mockResolvedValue(undefined)

    await do_.alarm()

    const stepReads = vi.mocked(fetch).mock.calls.filter(([u]) => String(u).includes('select=steps'))
    expect(stepReads).toHaveLength(0)
  })

  it('a hop carrying ANOTHER session\'s cache still rehydrates — stale steps must never be written back', async () => {
    const do_ = makeDO()
    const { storage } = makeStatefulStorage()
    do_.state = { storage }
    const loop = makeTwoStepLoopState()
    loop.nextStepIndex = 1
    await (do_ as any).saveStepLoopState(loop)
    await (do_ as any).state.storage.put('watchdog', {
      sessionId: loop.sessionId, stackId: loop.stackId,
      workflowId: loop.projectId, userId: loop.userId,
    })
    ;(do_ as any).cachedSteps = [{ name: 'stale', nodeId: 'nX', status: 'success' }]
    ;(do_ as any).cachedStepsSessionId = 'some-other-session'
    vi.spyOn(do_ as any, 'executeStep').mockResolvedValueOnce({ out: 'last' })
    vi.spyOn(do_ as any, 'finalizeSuccess').mockResolvedValue(undefined)

    await do_.alarm()

    const stepReads = vi.mocked(fetch).mock.calls.filter(([u]) => String(u).includes('select=steps'))
    expect(stepReads).toHaveLength(1)
    expect((do_ as any).cachedSteps.map((s: any) => s.name)).not.toContain('stale')
  })
})

describe('ProvisionerDO step loop — cross-invocation 10-minute deadline', () => {
  beforeEach(() => {
    // Second test's success path falls through to runOneStep's normal
    // bookkeeping (StepStarted emit, mutateCachedStep, stepCompleteRpc), all
    // sb()-backed — stub a permissive default so those calls don't hit real
    // fetch. The first (deadline-exceeded) test never reaches these calls.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })))
  })

  it('runOneStep bails out and cleans up when resumed past the 10-minute deploy deadline', async () => {
    const do_ = makeDO()
    const loop = makeTwoStepLoopState()
    loop.nextStepIndex = 1
    loop.deployStartedAt = Date.now() - 11 * 60 * 1000 // 11 minutes ago
    const executeStepSpy = vi.spyOn(do_ as any, 'executeStep')
    const cleanupSpy = vi.spyOn(do_ as any, 'handleTimeoutCleanup').mockResolvedValue(undefined)
    const result = await (do_ as any).runOneStep(loop)
    expect(result).toBe('done')
    expect(executeStepSpy).not.toHaveBeenCalled()
    expect(cleanupSpy).toHaveBeenCalledWith(loop.sessionId, loop.stackId, loop.userId)
  })

  it('runOneStep proceeds normally when well within the 10-minute deadline', async () => {
    const do_ = makeDO()
    const loop = makeTwoStepLoopState()
    loop.deployStartedAt = Date.now() - 5000 // 5 seconds ago
    vi.spyOn(do_ as any, 'executeStep').mockResolvedValueOnce({ out: '1' })
    const result = await (do_ as any).runOneStep(loop)
    expect(result).toBe('continue')
  })
})

// --- Vercel redeploy must not destroy the project on an inconclusive read ---
// Relink deletes the Vercel project and recreates it. A prod repro (2026-08-24)
// had the same node deleted and recreated across four consecutive deploys with
// the repo never changing — every deploy handing the user a fresh project id and
// dropping whatever was attached to the old one.
describe('ProvisionerDO.executeStep — vercel redeploy relink guard', () => {
  let calls: Array<{ url: string; method: string }>

  function stubVercel(projectGet: Array<{ status: number; body: unknown }>) {
    calls = []
    let getIdx = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      const method = String(init?.method ?? 'GET').toUpperCase()
      calls.push({ url: u, method })
      if (u.includes('/v9/projects/prj_1') && method === 'GET') {
        const r = projectGet[getIdx] ?? projectGet[projectGet.length - 1]
        getIdx++
        return new Response(JSON.stringify(r.body), { status: r.status })
      }
      if (u.includes('/v6/deployments')) {
        return new Response(JSON.stringify({ deployments: [{ uid: 'dpl_prev' }] }), { status: 200 })
      }
      if (u.includes('/v13/deployments')) {
        return new Response(JSON.stringify({ uid: 'dpl_new', url: 'web-abc.vercel.app' }), { status: 200 })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    }))
  }

  const step = {
    service: 'vercel',
    action: 'redeploy',
    nodeId: 'v1',
    nodeLabel: 'Vercel',
    params: { vercelProjectId: 'prj_1', existing_repo: 'https://github.com/acme/web' },
    injectEnvVars: [],
  } as any

  afterEach(() => vi.unstubAllGlobals())

  it('does NOT delete the project when the project read fails (transient 5xx/429)', async () => {
    // First GET fails, later ones succeed — exactly the shape of a rate limit or
    // a blip. This used to read as "no link => repo changed => delete it".
    stubVercel([
      { status: 500, body: {} },
      { status: 200, body: { name: 'web', link: { org: 'acme', repo: 'web' } } },
    ])
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('fake-token')

    const out = await do_.executeStep(step, {}, 'user-1', 'My Project')

    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect(out.vercel_project_id).toBe('prj_1')
    expect(out.vercel_deployment_id).toBe('dpl_new')
  })

  it('does NOT delete the project when the linked repo already matches', async () => {
    stubVercel([{ status: 200, body: { name: 'web', link: { org: 'acme', repo: 'web' } } }])
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('fake-token')

    const out = await do_.executeStep(step, {}, 'user-1', 'My Project')

    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect(out.vercel_project_id).toBe('prj_1')
  })

  it('still deletes + recreates when the repo genuinely changed', async () => {
    stubVercel([{ status: 200, body: { name: 'web', link: { org: 'acme', repo: 'other-repo' } } }])
    const do_ = makeDO()
    vi.spyOn(do_, 'getUserToken' as any).mockResolvedValue('fake-token')

    await do_.executeStep(step, {}, 'user-1', 'My Project')

    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/v9/projects/prj_1'))).toBe(true)
  })
})
