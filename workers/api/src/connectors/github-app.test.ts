import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  buildLeenarDeployWorkflowYaml,
  assertWranglerConfigExists,
  writeWorkflowFileAsApp,
  getInstallationTokenForRepo,
  dispatchWorkflow,
  findWorkflowRun,
  getWorkflowRunFailureTail,
  getWranglerWorkerName,
} from './github-app'
import { RateLimitError } from './errors'

afterEach(() => vi.restoreAllMocks())

// ── fetch mock helpers ────────────────────────────────────────────────────────

type FetchCall = { url: string; init?: RequestInit }

function makeFetchSpy(responses: Array<{ status: number; body?: unknown; text?: string }>) {
  let idx = 0
  const calls: FetchCall[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const { status, body, text } = responses[idx++] ?? { status: 200, body: {} }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body ?? {}),
      text: () => Promise.resolve(text ?? JSON.stringify(body ?? {})),
    }
  }))
  return calls
}

// writeWorkflowFileAsApp signs a real JWT via crypto.subtle before making any
// fetch calls (signAppJWT -> importPrivateKey -> crypto.subtle.importKey).
// Constructing a real importable PKCS#1 PEM here would just be re-testing
// signAppJWT (already exercised indirectly by pushLeenarCommitAsApp's own
// callers elsewhere). Stub crypto.subtle so the JWT-signing step is a no-op
// and these tests focus on the write-flow logic (fetch calls, branching,
// PUT body) that this task actually adds.
const DUMMY_PEM = '-----BEGIN PRIVATE KEY-----\nZHVtbXk=\n-----END PRIVATE KEY-----'

function stubCrypto() {
  vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue('fake-key' as unknown as CryptoKey)
  vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(new ArrayBuffer(8))
}

// ── buildLeenarDeployWorkflowYaml ───────────────────────────────────────────

describe('buildLeenarDeployWorkflowYaml', () => {
  it('with no opts: workflow_dispatch trigger only, no push key, no workingDirectory key', () => {
    const yaml = buildLeenarDeployWorkflowYaml()
    expect(yaml).toBe(
      [
        'name: Leenar Deploy',
        'on:',
        '  workflow_dispatch: {}',
        'jobs:',
        '  deploy:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v4',
        '      - uses: cloudflare/wrangler-action@9acf94ace14e7dc412b076f2c5c20b8ce93c79cd # v3.15.0',
        '        with:',
        '          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}',
        '          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
        '          command: deploy',
        '',
      ].join('\n'),
    )
    expect(yaml).not.toContain('push:')
    expect(yaml).not.toContain('workingDirectory')
    expect(yaml).not.toMatch(/\t/)
  })

  it('{ onPush: true } includes a push: branches: [main] trigger alongside workflow_dispatch', () => {
    const yaml = buildLeenarDeployWorkflowYaml({ onPush: true })
    expect(yaml).toContain('on:\n  workflow_dispatch: {}\n  push:\n    branches: [main]')
  })

  it('{ workingDirectory: "apps/worker" } includes workingDirectory in the wrangler-action step inputs', () => {
    const yaml = buildLeenarDeployWorkflowYaml({ workingDirectory: 'apps/worker' })
    expect(yaml).toContain('          workingDirectory: apps/worker')
    // Still directly under the wrangler-action `with:` block
    const withIdx = yaml.indexOf('cloudflare/wrangler-action@9acf94ace14e7dc412b076f2c5c20b8ce93c79cd')
    const wdIdx = yaml.indexOf('workingDirectory: apps/worker')
    expect(wdIdx).toBeGreaterThan(withIdx)
  })

  it('combining onPush and workingDirectory produces both', () => {
    const yaml = buildLeenarDeployWorkflowYaml({ onPush: true, workingDirectory: 'svc/api' })
    expect(yaml).toContain('push:\n    branches: [main]')
    expect(yaml).toContain('workingDirectory: svc/api')
  })

  it('{ workerName } scopes the deploy command with --name (branch safety)', () => {
    const yaml = buildLeenarDeployWorkflowYaml({ workerName: 'my-app-worker-staging' })
    expect(yaml).toContain('          command: deploy --name my-app-worker-staging')
    // Without workerName the command must remain a bare `deploy` (trunk).
    expect(buildLeenarDeployWorkflowYaml()).toContain('          command: deploy\n')
  })
})

// ── assertWranglerConfigExists ──────────────────────────────────────────────

describe('assertWranglerConfigExists', () => {
  it('resolves silently when wrangler.toml exists (200)', async () => {
    makeFetchSpy([{ status: 200, body: { sha: 'abc' } }])
    await expect(assertWranglerConfigExists('tok', 'org/repo')).resolves.toBeUndefined()
  })

  it('falls back to wrangler.jsonc when .toml 404s', async () => {
    const calls = makeFetchSpy([
      { status: 404, text: 'Not Found' },
      { status: 200, body: { sha: 'def' } },
    ])
    await expect(assertWranglerConfigExists('tok', 'org/repo')).resolves.toBeUndefined()
    expect(calls[0].url).toContain('wrangler.toml')
    expect(calls[1].url).toContain('wrangler.jsonc')
  })

  it('throws a clear actionable error when both wrangler.toml and wrangler.jsonc 404', async () => {
    makeFetchSpy([
      { status: 404, text: 'Not Found' },
      { status: 404, text: 'Not Found' },
    ])
    await expect(assertWranglerConfigExists('tok', 'org/repo')).rejects.toThrow(
      'No wrangler.toml or wrangler.jsonc found in org/repo. Add a Wrangler config file to your repo before deploying.',
    )
  })

  it('throws with workingDirectory suffix in the error message when provided', async () => {
    makeFetchSpy([
      { status: 404, text: 'Not Found' },
      { status: 404, text: 'Not Found' },
    ])
    await expect(
      assertWranglerConfigExists('tok', 'org/repo', 'apps/worker'),
    ).rejects.toThrow(
      'No wrangler.toml or wrangler.jsonc found in org/repo/apps/worker. Add a Wrangler config file to your repo before deploying.',
    )
  })

  it('prefixes the contents path with workingDirectory when provided', async () => {
    const calls = makeFetchSpy([{ status: 200, body: { sha: 'abc' } }])
    await assertWranglerConfigExists('tok', 'org/repo', 'apps/worker')
    expect(calls[0].url).toContain('/contents/apps/worker/wrangler.toml')
  })

  it('throws on non-2xx/non-404 response (e.g. 500) with status + truncated body', async () => {
    makeFetchSpy([{ status: 500, text: 'x'.repeat(1000) }])
    try {
      await assertWranglerConfigExists('tok', 'org/repo')
      expect.unreachable('expected to throw')
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain('500')
      // Message = "GitHub contents lookup failed: <status> <body>" — body is
      // truncated to 100 chars.
      const bodyPortion = msg.slice(msg.indexOf('500 ') + 4)
      expect(bodyPortion.length).toBeLessThanOrEqual(100)
      expect(bodyPortion).toBe('x'.repeat(100))
    }
  })
})

// ── writeWorkflowFileAsApp ───────────────────────────────────────────────────

describe('writeWorkflowFileAsApp', () => {
  it('returns false when there is no GitHub App installation for the repo', async () => {
    stubCrypto()
    makeFetchSpy([
      { status: 404 }, // getInstallationId: GET .../installation -> not ok
    ])
    const result = await writeWorkflowFileAsApp('app-1', DUMMY_PEM, 'org/repo')
    expect(result).toBe(false)
  })

  it('throws when the repo has no wrangler config (does not swallow into false)', async () => {
    stubCrypto()
    makeFetchSpy([
      { status: 200, body: { id: 123 } }, // getInstallationId
      { status: 200, body: { token: 'inst-tok' } }, // getInstallationToken
      { status: 404, text: 'Not Found' }, // wrangler.toml
      { status: 404, text: 'Not Found' }, // wrangler.jsonc
    ])
    await expect(writeWorkflowFileAsApp('app-1', DUMMY_PEM, 'org/repo')).rejects.toThrow(
      'No wrangler.toml or wrangler.jsonc found in org/repo. Add a Wrangler config file to your repo before deploying.',
    )
  })

  it('successful write when the workflow file does not exist yet (no sha in PUT body)', async () => {
    stubCrypto()
    const calls = makeFetchSpy([
      { status: 200, body: { id: 201 } }, // getInstallationId
      { status: 200, body: { token: 'inst-tok' } }, // getInstallationToken
      { status: 200, body: {} }, // wrangler.toml exists
      { status: 404, text: 'Not Found' }, // GET existing workflow file -> doesn't exist
      { status: 201, body: {} }, // PUT workflow file
    ])
    const result = await writeWorkflowFileAsApp('app-1', DUMMY_PEM, 'org/repo')
    expect(result).toBe(true)

    const putCall = calls.find(c => (c.init as RequestInit)?.method === 'PUT')
    expect(putCall).toBeDefined()
    expect(putCall!.url).toContain('/repos/org/repo/contents/.github/workflows/leenar-deploy.yml')
    const putBody = JSON.parse((putCall!.init as RequestInit).body as string)
    expect(putBody.sha).toBeUndefined()
    expect(putBody.message).toBe('Add: Leenar deploy workflow')

    const decodedYaml = atob(putBody.content)
    expect(decodedYaml).toBe(buildLeenarDeployWorkflowYaml())
  })

  it('successful write when the workflow file already exists (includes sha in PUT body)', async () => {
    stubCrypto()
    const calls = makeFetchSpy([
      { status: 200, body: { id: 202 } }, // getInstallationId
      { status: 200, body: { token: 'inst-tok' } }, // getInstallationToken
      { status: 200, body: {} }, // wrangler.toml exists
      { status: 200, body: { sha: 'existing-sha-123' } }, // GET existing workflow file -> exists
      { status: 200, body: {} }, // PUT workflow file
    ])
    const result = await writeWorkflowFileAsApp('app-1', DUMMY_PEM, 'org/repo', { workingDirectory: 'apps/worker' })
    expect(result).toBe(true)

    const putCall = calls.find(c => (c.init as RequestInit)?.method === 'PUT')
    const putBody = JSON.parse((putCall!.init as RequestInit).body as string)
    expect(putBody.sha).toBe('existing-sha-123')

    const decodedYaml = atob(putBody.content)
    expect(decodedYaml).toBe(buildLeenarDeployWorkflowYaml({ workingDirectory: 'apps/worker' }))
  })

  it('returns false (does not throw) when the PUT write fails', async () => {
    stubCrypto()
    makeFetchSpy([
      { status: 200, body: { id: 203 } }, // getInstallationId
      { status: 200, body: { token: 'inst-tok' } }, // getInstallationToken
      { status: 200, body: {} }, // wrangler.toml exists
      { status: 404, text: 'Not Found' }, // GET existing workflow file -> doesn't exist
      { status: 500, text: 'Internal Server Error' }, // PUT fails
    ])
    const result = await writeWorkflowFileAsApp('app-1', DUMMY_PEM, 'org/repo')
    expect(result).toBe(false)
  })

  it('checks the wrangler config under workingDirectory before writing', async () => {
    stubCrypto()
    const calls = makeFetchSpy([
      { status: 200, body: { id: 204 } }, // getInstallationId
      { status: 200, body: { token: 'inst-tok' } }, // getInstallationToken
      { status: 200, body: {} }, // wrangler.toml exists under workingDirectory
      { status: 404, text: 'Not Found' }, // GET existing workflow file -> doesn't exist
      { status: 201, body: {} }, // PUT workflow file
    ])
    await writeWorkflowFileAsApp('app-1', DUMMY_PEM, 'org/repo', { workingDirectory: 'apps/worker' })
    const wranglerCheckCall = calls.find(c => c.url.includes('wrangler.toml'))
    expect(wranglerCheckCall!.url).toContain('/contents/apps/worker/wrangler.toml')
  })
})

// ── getInstallationTokenForRepo ─────────────────────────────────────────────

describe('getInstallationTokenForRepo', () => {
  it('resolves the installation token when the App is installed on the repo', async () => {
    stubCrypto()
    makeFetchSpy([
      { status: 200, body: { id: 301 } }, // getInstallationId
      { status: 200, body: { token: 'inst-tok-301' } }, // getInstallationToken
    ])
    const token = await getInstallationTokenForRepo('app-1', DUMMY_PEM, 'org/repo')
    expect(token).toBe('inst-tok-301')
  })

  it('returns null (not a throw) when there is no installation for the repo', async () => {
    stubCrypto()
    makeFetchSpy([
      { status: 404 }, // getInstallationId -> not ok
    ])
    const token = await getInstallationTokenForRepo('app-1', DUMMY_PEM, 'org/repo')
    expect(token).toBeNull()
  })
})

// ── dispatchWorkflow ─────────────────────────────────────────────────────────

describe('dispatchWorkflow', () => {
  it('resolves on a 204 with no body', async () => {
    const calls = makeFetchSpy([{ status: 204 }])
    await expect(
      dispatchWorkflow('tok', 'org/repo', 'leenar-deploy.yml', 'main'),
    ).resolves.toBeUndefined()
    expect(calls[0].url).toContain('/repos/org/repo/actions/workflows/leenar-deploy.yml/dispatches')
    const body = JSON.parse((calls[0].init as RequestInit).body as string)
    expect(body).toEqual({ ref: 'main' })
  })

  it('throws with status + truncated body on failure', async () => {
    makeFetchSpy([{ status: 422, text: 'y'.repeat(500) }])
    try {
      await dispatchWorkflow('tok', 'org/repo', 'leenar-deploy.yml', 'main')
      expect.unreachable('expected to throw')
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain('422')
      expect(msg).toContain('y'.repeat(100))
      expect(msg).not.toContain('y'.repeat(101))
    }
  })
})

describe('dispatchWorkflow — rate limit + bounded fetch', () => {
  it('throws RateLimitError on 429 with the Retry-After wait', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('rate limited', { status: 429, headers: { 'Retry-After': '30' } }),
    ))
    await expect(
      dispatchWorkflow('tok', 'owner/repo', 'leenar-deploy.yml', 'main'),
    ).rejects.toBeInstanceOf(RateLimitError)
    vi.unstubAllGlobals()
  })

  it('passes a signal to the dispatch fetch', async () => {
    let sawSignal = false
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      sawSignal = !!init?.signal
      return new Response(null, { status: 204 })
    }))
    await dispatchWorkflow('tok', 'owner/repo', 'leenar-deploy.yml', 'main')
    expect(sawSignal).toBe(true)
    vi.unstubAllGlobals()
  })
})

// ── findWorkflowRun ──────────────────────────────────────────────────────────

describe('findWorkflowRun', () => {
  it('returns the newest run when workflow_runs is non-empty', async () => {
    const calls = makeFetchSpy([
      {
        status: 200,
        body: {
          workflow_runs: [
            { id: 999, status: 'in_progress', conclusion: null, html_url: 'https://github.com/org/repo/actions/runs/999' },
            { id: 998, status: 'completed', conclusion: 'success', html_url: 'https://github.com/org/repo/actions/runs/998' },
          ],
        },
      },
    ])
    const run = await findWorkflowRun('tok', 'org/repo', 'leenar-deploy.yml', '2026-01-01T00:00:00.000Z')
    expect(run).toEqual({ id: 999, status: 'in_progress', conclusion: null, html_url: 'https://github.com/org/repo/actions/runs/999' })
    expect(calls[0].url).toContain('event=workflow_dispatch')
    expect(calls[0].url).toContain(encodeURIComponent('>2026-01-01T00:00:00.000Z'))
  })

  it('returns null when workflow_runs is empty (run has not shown up yet)', async () => {
    makeFetchSpy([{ status: 200, body: { workflow_runs: [] } }])
    const run = await findWorkflowRun('tok', 'org/repo', 'leenar-deploy.yml', '2026-01-01T00:00:00.000Z')
    expect(run).toBeNull()
  })

  it('throws with status + truncated body on failure', async () => {
    makeFetchSpy([{ status: 500, text: 'z'.repeat(500) }])
    await expect(
      findWorkflowRun('tok', 'org/repo', 'leenar-deploy.yml', '2026-01-01T00:00:00.000Z'),
    ).rejects.toThrow(/500/)
  })
})

// ── getWorkflowRunFailureTail ────────────────────────────────────────────────

describe('getWorkflowRunFailureTail', () => {
  it('collects annotation messages from failed jobs, joined by newline', async () => {
    makeFetchSpy([
      {
        status: 200,
        body: {
          jobs: [
            { id: 1, name: 'deploy', conclusion: 'failure' },
            { id: 2, name: 'lint', conclusion: 'success' },
          ],
        },
      },
      {
        status: 200,
        body: [
          { title: 'Error', message: 'wrangler.toml missing account_id' },
          { title: null, message: 'exit code 1' },
        ],
      },
    ])
    const tail = await getWorkflowRunFailureTail('tok', 'org/repo', 42)
    expect(tail).toContain('wrangler.toml missing account_id')
    expect(tail).toContain('exit code 1')
  })

  it('falls back to job name + conclusion when no annotations are found', async () => {
    makeFetchSpy([
      {
        status: 200,
        body: {
          jobs: [{ id: 1, name: 'deploy', conclusion: 'failure' }],
        },
      },
      { status: 200, body: [] }, // no annotations
    ])
    const tail = await getWorkflowRunFailureTail('tok', 'org/repo', 42)
    expect(tail).toContain('deploy')
    expect(tail).toContain('failure')
  })

  it('is best-effort: returns a fallback string (does not throw) when the jobs fetch fails', async () => {
    makeFetchSpy([{ status: 500, text: 'boom' }])
    const tail = await getWorkflowRunFailureTail('tok', 'org/repo', 42)
    expect(typeof tail).toBe('string')
    expect(tail.length).toBeGreaterThan(0)
  })

  it('truncates to maxChars', async () => {
    makeFetchSpy([
      { status: 200, body: { jobs: [{ id: 1, name: 'deploy', conclusion: 'failure' }] } },
      { status: 200, body: [{ message: 'x'.repeat(5000) }] },
    ])
    const tail = await getWorkflowRunFailureTail('tok', 'org/repo', 42, 50)
    expect(tail.length).toBeLessThanOrEqual(50)
  })
})

// ── getWranglerWorkerName ────────────────────────────────────────────────────

describe('getWranglerWorkerName', () => {
  it('parses the top-level name from wrangler.toml', async () => {
    const toml = 'name = "my-worker"\ncompatibility_date = "2024-01-01"\n\n[vars]\nFOO = "bar"\n'
    makeFetchSpy([
      { status: 200, body: { content: btoa(toml) } },
    ])
    const name = await getWranglerWorkerName('tok', 'org/repo')
    expect(name).toBe('my-worker')
  })

  it('falls back to wrangler.jsonc (stripping // comments) when .toml is unavailable', async () => {
    const jsonc = '// comment\n{\n  "name": "jsonc-worker"\n}\n'
    makeFetchSpy([
      { status: 404 }, // wrangler.toml not found
      { status: 200, body: { content: btoa(jsonc) } },
    ])
    const name = await getWranglerWorkerName('tok', 'org/repo')
    expect(name).toBe('jsonc-worker')
  })

  it('returns null when neither file is readable', async () => {
    makeFetchSpy([
      { status: 404 },
      { status: 404 },
    ])
    const name = await getWranglerWorkerName('tok', 'org/repo')
    expect(name).toBeNull()
  })
})
