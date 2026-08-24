import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { injectVercelEnvVars, assertVercelGitHubLinked, promoteVercelDeployment, getVercelObservability, provisionVercel, deleteVercelEnvVar, relinkVercelWithGitHub, shouldRelinkVercelProject, triggerVercelDeployment, redeployVercel, narrowClientEnvPrefixes, getVercelDeploymentState } from './vercel'
import { RateLimitError } from './errors'

afterEach(() => vi.restoreAllMocks())

// ── fetch mock helpers ────────────────────────────────────────────────────────

type FetchCall = { url: string; init?: RequestInit }

function makeFetchSpy(responses: Array<{ status: number; body: unknown }>) {
  let idx = 0
  const calls: FetchCall[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const { status, body } = responses[idx++] ?? { status: 200, body: {} }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    }
  }))
  return calls
}

// ── injectVercelEnvVars ───────────────────────────────────────────────────────

describe('injectVercelEnvVars', () => {
  it('skips when all env values are undefined', async () => {
    const calls = makeFetchSpy([])
    await injectVercelEnvVars('tok', 'proj-1', { KEY: undefined })
    expect(calls).toHaveLength(0)
  })

  it('bulk-POSTs new env vars when none exist yet', async () => {
    const calls = makeFetchSpy([
      { status: 200, body: { envs: [] } },   // getExistingEnvs
      { status: 200, body: {} },              // bulk POST
    ])
    await injectVercelEnvVars('tok', 'proj-2', { DB_URL: 'postgres://...' })
    // First call: GET existing envs
    expect(calls[0].url).toContain('/env')
    expect((calls[0].init as RequestInit | undefined)?.method).toBeUndefined() // GET
    // Second call: POST new vars
    expect(calls[1].url).toContain('/env')
    expect((calls[1].init as RequestInit).method).toBe('POST')
    const postedBody = JSON.parse((calls[1].init as RequestInit).body as string) as Array<{ key: string }>
    expect(postedBody[0].key).toBe('DB_URL')
  })

  it('PATCHes existing env vars when they already exist', async () => {
    const calls = makeFetchSpy([
      { status: 200, body: { envs: [{ key: 'DB_URL', id: 'env-id-1' }] } }, // getExistingEnvs
      { status: 200, body: {} },  // PATCH
    ])
    await injectVercelEnvVars('tok', 'proj-3', { DB_URL: 'postgres://new' })
    expect(calls).toHaveLength(2)
    expect((calls[1].init as RequestInit).method).toBe('PATCH')
    expect(calls[1].url).toContain('env-id-1')
  })

  it('PATCHes existing and POSTs new vars in the same call', async () => {
    const calls = makeFetchSpy([
      { status: 200, body: { envs: [{ key: 'EXISTING', id: 'env-old' }] } }, // getExistingEnvs
      { status: 200, body: {} },  // PATCH for EXISTING
      { status: 200, body: {} },  // POST for NEW_KEY
    ])
    await injectVercelEnvVars('tok', 'proj-4', { EXISTING: 'val1', NEW_KEY: 'val2' })
    const methods = calls.slice(1).map(c => (c.init as RequestInit).method)
    expect(methods).toContain('PATCH')
    expect(methods).toContain('POST')
  })

  it('skips undefined values from the candidate list', async () => {
    const calls = makeFetchSpy([
      { status: 200, body: { envs: [] } },
      { status: 200, body: {} },
    ])
    await injectVercelEnvVars('tok', 'proj-5', {
      REAL: 'value',
      SKIP: undefined,
    })
    const postBody = JSON.parse((calls[1].init as RequestInit).body as string) as Array<{ key: string }>
    expect(postBody).toHaveLength(1)
    expect(postBody[0].key).toBe('REAL')
  })

  it('busts the cache after a POST so a later op uses the real env id, not a placeholder', async () => {
    // First call — GET (empty) then POST creates key A
    const calls1 = makeFetchSpy([
      { status: 200, body: { envs: [] } }, // getExistingEnvs
      { status: 200, body: {} },            // bulk POST
    ])
    await injectVercelEnvVars('tok', 'proj-cached', { A: 'a' })
    expect(calls1.filter(c => !c.init?.method).length).toBe(1) // one GET

    // Second call within 60 s for the same key — the cache was busted by the
    // POST, so a fresh GET returns A's REAL id and A is PATCHed at that id.
    // (Previously a fake "injected" placeholder would have sent the PATCH to
    // /env/injected and failed.)
    vi.restoreAllMocks()
    const calls2 = makeFetchSpy([
      { status: 200, body: { envs: [{ key: 'A', id: 'real-id-A' }] } }, // GET
      { status: 200, body: {} },                                        // PATCH
    ])
    await injectVercelEnvVars('tok', 'proj-cached', { A: 'a2' })
    // A fresh GET is performed because the cache was busted
    expect(calls2.filter(c => !(c.init as RequestInit | undefined)?.method)).toHaveLength(1)
    // The PATCH targets the real id, never the "injected" placeholder
    const patch = calls2.find(c => (c.init as RequestInit | undefined)?.method === 'PATCH')
    expect(patch?.url).toContain('/env/real-id-A')
    expect(patch?.url).not.toContain('/env/injected')
  })

  it('redacts the secret value out of a failed PATCH response body before logging', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    makeFetchSpy([
      { status: 200, body: { envs: [{ key: 'DB_URL', id: 'env-id-1' }] } }, // getExistingEnvs
      { status: 400, body: { error: 'invalid value: sk-leaked-secret-value' } }, // PATCH fails, echoes the value back
    ])
    await expect(
      injectVercelEnvVars('tok', 'proj-err', { DB_URL: 'sk-leaked-secret-value' }),
    ).rejects.toThrow('Failed to update env vars on Vercel: DB_URL')

    const logged = warnSpy.mock.calls.map((c) => c[0] as string).join('\n')
    expect(logged).not.toContain('sk-leaked-secret-value')
    expect(logged).toContain('[REDACTED]')
  })
})

// ── provisionVercel — Vite + Next.js env var union ──────────────────────────

describe('provisionVercel — framework-aware Supabase env var names', () => {
  it('injects both NEXT_PUBLIC_SUPABASE_* and VITE_SUPABASE_* names from lowercase ctx keys', async () => {
    const calls = makeFetchSpy([
      { status: 200, body: { name: 'my-proj', link: {} } }, // GET project (retry path)
      { status: 200, body: { envs: [] } },                   // getExistingEnvs
      { status: 200, body: {} },                              // bulk POST env vars
    ])
    await provisionVercel(
      'tok',
      'my-proj',
      {},
      { vercelProjectId: 'proj-union-1' },
      {
        supabase_url: 'https://xyz.supabase.co',
        supabase_anon_key: 'anon-key-123',
        supabase_service_role: 'service-role-456',
      },
    )
    const postCall = calls.find(c => (c.init as RequestInit | undefined)?.method === 'POST')
    expect(postCall).toBeDefined()
    const posted = JSON.parse((postCall!.init as RequestInit).body as string) as Array<{ key: string; value: string }>
    const byKey = Object.fromEntries(posted.map(e => [e.key, e.value]))

    expect(byKey.NEXT_PUBLIC_SUPABASE_URL).toBe('https://xyz.supabase.co')
    expect(byKey.VITE_SUPABASE_URL).toBe('https://xyz.supabase.co')
    expect(byKey.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('anon-key-123')
    expect(byKey.VITE_SUPABASE_ANON_KEY).toBe('anon-key-123')
    expect(byKey.SUPABASE_SERVICE_ROLE_KEY).toBe('service-role-456')
  })

  it('prefers an already-uppercase VITE_/NEXT_PUBLIC_ key over the lowercase ctx fallback', async () => {
    const calls = makeFetchSpy([
      { status: 200, body: { name: 'my-proj', link: {} } }, // GET project (retry path)
      { status: 200, body: { envs: [] } },                   // getExistingEnvs
      { status: 200, body: {} },                              // bulk POST env vars
    ])
    await provisionVercel(
      'tok',
      'my-proj',
      {},
      { vercelProjectId: 'proj-union-2' },
      {
        NEXT_PUBLIC_SUPABASE_URL: 'https://explicit-next.supabase.co',
        VITE_SUPABASE_URL: 'https://explicit-vite.supabase.co',
        supabase_url: 'https://fallback.supabase.co',
      },
    )
    const postCall = calls.find(c => (c.init as RequestInit | undefined)?.method === 'POST')
    const posted = JSON.parse((postCall!.init as RequestInit).body as string) as Array<{ key: string; value: string }>
    const byKey = Object.fromEntries(posted.map(e => [e.key, e.value]))

    expect(byKey.NEXT_PUBLIC_SUPABASE_URL).toBe('https://explicit-next.supabase.co')
    expect(byKey.VITE_SUPABASE_URL).toBe('https://explicit-vite.supabase.co')
  })

  it('with framework: vite, injects only VITE_ prefix (no NEXT_PUBLIC_) then narrows', async () => {
    const calls = makeFetchSpy([
      { status: 200, body: { name: 'my-proj', link: {} } }, // GET project (retry path)
      { status: 200, body: { envs: [] } },                   // getExistingEnvs
      { status: 200, body: {} },                              // bulk POST env vars
      { status: 200, body: { envs: [] } },                   // narrow: listVercelEnvVars (nothing to delete)
    ])
    await provisionVercel(
      'tok',
      'my-proj',
      {},
      { vercelProjectId: 'proj-vite-1', framework: 'vite' },
      { supabase_url: 'https://xyz.supabase.co', supabase_anon_key: 'anon-key-123' },
    )
    const postCall = calls.find(c => (c.init as RequestInit | undefined)?.method === 'POST')
    const posted = JSON.parse((postCall!.init as RequestInit).body as string) as Array<{ key: string; value: string }>
    const byKey = Object.fromEntries(posted.map(e => [e.key, e.value]))

    expect(byKey.VITE_SUPABASE_URL).toBe('https://xyz.supabase.co')
    expect(byKey.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined()
    expect(byKey.PUBLIC_SUPABASE_URL).toBeUndefined()
  })
})

describe('narrowClientEnvPrefixes', () => {
  it('deletes wrong-prefix twins, keeps correct + user vars', async () => {
    const envList = {
      envs: [
        { key: 'NEXT_PUBLIC_SUPABASE_URL', id: 'id1' },
        { key: 'VITE_SUPABASE_URL', id: 'id2' },
        { key: 'PUBLIC_SUPABASE_URL', id: 'id3' },
        { key: 'SUPABASE_SERVICE_ROLE_KEY', id: 'id4' },
        { key: 'NEXT_PUBLIC_MY_CUSTOM', id: 'id5' },
      ],
    }
    const calls = makeFetchSpy([
      { status: 200, body: envList }, // listVercelEnvVars GET
      { status: 200, body: {} },       // DELETE NEXT_PUBLIC_SUPABASE_URL
      { status: 200, body: envList }, // GET (cache busted by first delete)
      { status: 200, body: {} },       // DELETE PUBLIC_SUPABASE_URL
    ])
    const deleted = await narrowClientEnvPrefixes('tok', 'proj-narrow', ['SUPABASE_URL'], 'vite')
    expect(deleted.sort()).toEqual(['NEXT_PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_URL'])
    const deleteCalls = calls.filter(c => (c.init as RequestInit | undefined)?.method === 'DELETE')
    expect(deleteCalls).toHaveLength(2)
    expect(deleteCalls.some(c => c.url.includes('id2'))).toBe(false) // VITE_ kept
    expect(deleteCalls.some(c => c.url.includes('id5'))).toBe(false) // user custom kept
  })

  it('keeps PUBLIC_ and deletes NEXT_PUBLIC_/VITE_ for SvelteKit', async () => {
    // Regression: a SvelteKit repo carries vite.config so it used to be detected
    // as 'vite' and get narrowed to VITE_, deleting the PUBLIC_ vars its app reads.
    const envList = {
      envs: [
        { key: 'NEXT_PUBLIC_SUPABASE_URL', id: 'id1' },
        { key: 'VITE_SUPABASE_URL', id: 'id2' },
        { key: 'PUBLIC_SUPABASE_URL', id: 'id3' },
      ],
    }
    const calls = makeFetchSpy([
      { status: 200, body: envList }, // GET
      { status: 200, body: {} },       // DELETE NEXT_PUBLIC_SUPABASE_URL
      { status: 200, body: envList }, // GET
      { status: 200, body: {} },       // DELETE VITE_SUPABASE_URL
    ])
    const deleted = await narrowClientEnvPrefixes('tok', 'proj-svelte', ['SUPABASE_URL'], 'svelte')
    expect(deleted.sort()).toEqual(['NEXT_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_URL'])
    const deleteCalls = calls.filter(c => (c.init as RequestInit | undefined)?.method === 'DELETE')
    expect(deleteCalls.some(c => c.url.includes('id3'))).toBe(false) // PUBLIC_ kept
  })

  it('keeps NUXT_PUBLIC_ and deletes other-framework twins for Nuxt', async () => {
    // Nuxt bundles vite so it used to be detected as 'vite'; its app reads NUXT_PUBLIC_.
    const envList = {
      envs: [
        { key: 'NEXT_PUBLIC_SUPABASE_URL', id: 'id1' },
        { key: 'VITE_SUPABASE_URL', id: 'id2' },
        { key: 'NUXT_PUBLIC_SUPABASE_URL', id: 'id3' },
      ],
    }
    const calls = makeFetchSpy([
      { status: 200, body: envList }, // GET
      { status: 200, body: {} },       // DELETE NEXT_PUBLIC_SUPABASE_URL
      { status: 200, body: envList }, // GET
      { status: 200, body: {} },       // DELETE VITE_SUPABASE_URL
    ])
    const deleted = await narrowClientEnvPrefixes('tok', 'proj-nuxt', ['SUPABASE_URL'], 'nuxt')
    expect(deleted.sort()).toEqual(['NEXT_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_URL'])
    const deleteCalls = calls.filter(c => (c.init as RequestInit | undefined)?.method === 'DELETE')
    expect(deleteCalls.some(c => c.url.includes('id3'))).toBe(false) // NUXT_PUBLIC_ kept
  })
})

// ── assertVercelGitHubLinked ─────────────────────────────────────────────────

describe('assertVercelGitHubLinked', () => {
  it('resolves without error when GitHub namespaces are present', async () => {
    makeFetchSpy([{ status: 200, body: { namespaces: [{ id: 1 }] } }])
    await expect(assertVercelGitHubLinked('tok')).resolves.toBeUndefined()
  })

  it('throws when namespaces array is empty', async () => {
    makeFetchSpy([{ status: 200, body: { namespaces: [] } }])
    await expect(assertVercelGitHubLinked('tok')).rejects.toThrow('not linked to GitHub')
  })

  it('resolves (no throw) when the check API call fails — fail-open', async () => {
    makeFetchSpy([{ status: 403, body: {} }])
    await expect(assertVercelGitHubLinked('tok')).resolves.toBeUndefined()
  })

  it('handles array response format in addition to {namespaces:[]} envelope', async () => {
    makeFetchSpy([{ status: 200, body: [{ id: 1 }] }])
    await expect(assertVercelGitHubLinked('tok')).resolves.toBeUndefined()
  })

  it('throws when array response is empty', async () => {
    makeFetchSpy([{ status: 200, body: [] }])
    await expect(assertVercelGitHubLinked('tok')).rejects.toThrow()
  })

  it('tells a collaborator the real fix when the repo owner is a personal GitHub account', async () => {
    makeFetchSpy([
      { status: 200, body: { namespaces: [{ slug: 'someone-else' }] } }, // owner not in namespaces
      { status: 200, body: { type: 'User' } }, // github.com/users/{owner} → personal account
    ])
    await expect(assertVercelGitHubLinked('tok', 'mahmutefedara/widgets')).rejects.toThrow(
      /owned by a personal GitHub account.*collaborator/is,
    )
  })

  it('keeps the org-admin message when the repo owner is an organization', async () => {
    makeFetchSpy([
      { status: 200, body: { namespaces: [{ slug: 'someone-else' }] } },
      { status: 200, body: { type: 'Organization' } },
    ])
    await expect(assertVercelGitHubLinked('tok', 'acme-corp/widgets')).rejects.toThrow(
      /admin of that org must install it/,
    )
  })

  it('falls back to the org-admin message when the GitHub account-type probe fails', async () => {
    makeFetchSpy([
      { status: 200, body: { namespaces: [{ slug: 'someone-else' }] } },
      { status: 500, body: {} },
    ])
    await expect(assertVercelGitHubLinked('tok', 'acme-corp/widgets')).rejects.toThrow(
      /admin of that org must install it/,
    )
  })
})

// ── getVercelObservability ────────────────────────────────────────────────────

describe("getVercelObservability", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("computes success rate and avg build duration", async () => {
    const now = Date.now();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        deployments: [
          { uid: "d1", state: "READY",  createdAt: now - 5000, buildingAt: now - 4000, ready: now - 1000 },
          { uid: "d2", state: "READY",  createdAt: now - 8000, buildingAt: now - 7000, ready: now - 4000 },
          { uid: "d3", state: "ERROR",  createdAt: now - 3000, buildingAt: now - 2500, ready: null },
        ],
      }), { status: 200 }),
    );

    const result = await getVercelObservability("tok", "proj123");
    expect(result).toMatchObject({
      status: "ok",
      totalDeploys7d: 3,
      successRate7d: expect.closeTo(2 / 3, 5),
      avgBuildMs: expect.any(Number),
    });
  });

  it("returns error on fetch failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("", { status: 500 }),
    );
    expect(await getVercelObservability("tok", "proj")).toEqual({ status: "error" });
  });

  it("handles empty deployment list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ deployments: [] }), { status: 200 }),
    );
    const result = await getVercelObservability("tok", "proj");
    expect(result).toMatchObject({ status: "ok", totalDeploys7d: 0, successRate7d: 0, avgBuildMs: 0 });
  });
});

// ── promoteVercelDeployment ───────────────────────────────────────────────────

describe('promoteVercelDeployment', () => {
  it('returns ok:true on 200', async () => {
    makeFetchSpy([{ status: 200, body: {} }])
    const result = await promoteVercelDeployment('tok', 'proj-1', 'dep-1')
    expect(result).toEqual({ ok: true })
  })

  it('returns ok:false with GC message on 404', async () => {
    makeFetchSpy([{ status: 404, body: {} }])
    const result = await promoteVercelDeployment('tok', 'proj-1', 'dep-missing')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not found|garbage/i)
  })

  it('returns ok:false with GC message on 410', async () => {
    makeFetchSpy([{ status: 410, body: {} }])
    const result = await promoteVercelDeployment('tok', 'proj-1', 'dep-gc')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not found|garbage/i)
  })

  it('returns ok:false with error message on other failure', async () => {
    makeFetchSpy([{ status: 503, body: { error: { message: 'Service unavailable' } } }])
    const result = await promoteVercelDeployment('tok', 'proj-1', 'dep-err')
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('redacts the token out of a failed response body', async () => {
    makeFetchSpy([
      { status: 500, body: { error: { message: 'auth failed for secret-vercel-token' } } },
    ])
    const result = await promoteVercelDeployment('secret-vercel-token', 'proj-1', 'dep-err')
    expect(result.ok).toBe(false)
    expect(result.error).not.toContain('secret-vercel-token')
  })
})

// ── deleteVercelEnvVar ────────────────────────────────────────────────────────

describe('deleteVercelEnvVar', () => {
  it('redacts the token out of a failed DELETE response body', async () => {
    makeFetchSpy([
      { status: 200, body: { envs: [{ key: 'DB_URL', id: 'env-id-1' }] } }, // getExistingEnvs
      { status: 403, body: 'forbidden: bad-vercel-token' }, // DELETE fails
    ])
    await expect(
      deleteVercelEnvVar('bad-vercel-token', 'proj-1', 'DB_URL'),
    ).rejects.toThrow(/\[REDACTED\]/)
  })

  it('is a no-op (resolves) when the key does not exist', async () => {
    makeFetchSpy([{ status: 200, body: { envs: [] } }])
    await expect(deleteVercelEnvVar('tok', 'proj-1', 'MISSING')).resolves.toBeUndefined()
  })
})

// ── shouldRelinkVercelProject ─────────────────────────────────────────────────

// Relink DELETES the Vercel project and recreates it, taking the custom
// domains, deployment history and analytics with it. A prod repro (2026-08-24)
// had the same node deleted and recreated on four consecutive deploys with the
// repo never changing, so every "we aren't sure" answer here must be `false`.
describe('shouldRelinkVercelProject', () => {
  it('does NOT relink when the project could not be read', () => {
    // A 429 or a 5xx used to read as "no link -> repo changed -> destroy it".
    expect(shouldRelinkVercelProject({ ok: false }, 'acme/web')).toBe(false)
    expect(shouldRelinkVercelProject({ ok: false, link: null }, 'acme/web')).toBe(false)
    expect(shouldRelinkVercelProject({ ok: false, status: 429 }, 'acme/web')).toBe(false)
    expect(shouldRelinkVercelProject({ ok: false, status: 500 }, 'acme/web')).toBe(false)
  })

  it('DOES relink on a 404 — the project is gone, not unreadable', () => {
    // Conclusive, not transient: the canvas points at a project that no longer
    // exists (deleted in the dashboard, or orphaned by a half-finished deploy).
    // There is nothing to destroy and recreating is the only way the node works
    // again — without this the node is stuck failing forever.
    expect(shouldRelinkVercelProject({ ok: false, status: 404 }, 'acme/web')).toBe(true)
  })

  it('does NOT relink when the linked repo already matches', () => {
    expect(
      shouldRelinkVercelProject({ ok: true, link: { org: 'acme', repo: 'web' } }, 'acme/web'),
    ).toBe(false)
  })

  it('does NOT relink on a case difference (GitHub names are case-insensitive)', () => {
    expect(
      shouldRelinkVercelProject({ ok: true, link: { org: 'Acme', repo: 'Web' } }, 'acme/web'),
    ).toBe(false)
  })

  it('does NOT relink when Vercel reports the bare repo name and it matches', () => {
    // `${org}/${repo}` collapsed to just `repo` never equals the owner-qualified
    // canvas value, so this shape relinked on every single deploy, forever.
    expect(
      shouldRelinkVercelProject({ ok: true, link: { repo: 'web' } }, 'acme/web'),
    ).toBe(false)
  })

  it('DOES relink when the linked repo genuinely differs', () => {
    expect(
      shouldRelinkVercelProject({ ok: true, link: { org: 'acme', repo: 'api' } }, 'acme/web'),
    ).toBe(true)
    expect(
      shouldRelinkVercelProject({ ok: true, link: { org: 'other', repo: 'web' } }, 'acme/web'),
    ).toBe(true)
    expect(
      shouldRelinkVercelProject({ ok: true, link: { repo: 'api' } }, 'acme/web'),
    ).toBe(true)
  })

  it('DOES relink when the project has no git connection at all', () => {
    // The case the function exists for: Vercel cannot PATCH git integration
    // onto an existing project, so delete + recreate is the only route.
    expect(shouldRelinkVercelProject({ ok: true, link: null }, 'acme/web')).toBe(true)
    expect(shouldRelinkVercelProject({ ok: true }, 'acme/web')).toBe(true)
    expect(shouldRelinkVercelProject({ ok: true, link: { org: 'acme' } }, 'acme/web')).toBe(true)
  })
})

// ── relinkVercelWithGitHub ────────────────────────────────────────────────────

describe('relinkVercelWithGitHub — deployment id', () => {
  // The relink branch triggers a real production build, but used to drop the
  // deployment's id on the floor. Every consumer downstream keys off
  // `vercel_deployment_id` to decide whether a service is still building —
  // DeploySuccessModal renders a service with no id as READY, with a live link,
  // while Vercel is still building it. Measured over 79 prod Vercel steps: the
  // 8 with no deployment id were exactly the 8 that relinked.
  it('returns the id of the deployment it triggered', async () => {
    makeFetchSpy([
      { status: 200, body: { name: 'my-project' } },                       // GET existing project
      { status: 200, body: { envs: [] } },                                 // GET env snapshot
      { status: 200, body: {} },                                           // DELETE old project
      { status: 200, body: {                                               // POST recreate
        id: 'prj_new', name: 'my-project',
        link: { repoId: 42, defaultBranch: 'main' },
      } },
      { status: 200, body: { uid: 'dpl_relink', url: 'my-project-abc.vercel.app' } }, // POST deployment
    ])
    const out = await relinkVercelWithGitHub('tok', 'prj_old', 'org/repo')
    expect(out.vercel_deployment_id).toBe('dpl_relink')
    expect(out.vercel_project_id).toBe('prj_new')
    expect(out.vercel_project_url).toBe('https://my-project-abc.vercel.app')
  })

  it('falls back to `id` when Vercel returns no `uid`', async () => {
    makeFetchSpy([
      { status: 200, body: { name: 'my-project' } },
      { status: 200, body: { envs: [] } },
      { status: 200, body: {} },
      { status: 200, body: { id: 'prj_new', name: 'my-project', link: { repoId: 42, defaultBranch: 'main' } } },
      { status: 200, body: { id: 'dpl_relink', url: 'my-project-abc.vercel.app' } },
    ])
    const out = await relinkVercelWithGitHub('tok', 'prj_old', 'org/repo')
    expect(out.vercel_deployment_id).toBe('dpl_relink')
  })

  it('names the recreated project from the caller fallback when the old one is a 404', async () => {
    // The 404 recovery path can never read the dead project's name, so without
    // a fallback every recovered project was renamed to the literal
    // "my-project" (seen in prod 2026-08-24 03:46).
    const calls = makeFetchSpy([
      { status: 404, body: {} },                                            // GET existing project — gone
      { status: 404, body: {} },                                            // GET env snapshot — gone
      { status: 404, body: {} },                                            // DELETE — already gone, tolerated
      { status: 200, body: { id: 'prj_new', name: 'tanstack-start-ts', link: { repoId: 42, defaultBranch: 'main' } } },
      { status: 200, body: { uid: 'dpl_relink', url: 'x.vercel.app' } },
    ])
    await relinkVercelWithGitHub('tok', 'prj_gone', 'org/repo', {}, undefined, 'Tanstack Start TS')
    const createBody = JSON.parse(String(calls[3].init?.body))
    expect(createBody.name).toBe('tanstack-start-ts')
  })

  it('leaves the id undefined when no deployment could be triggered', async () => {
    makeFetchSpy([
      { status: 200, body: { name: 'my-project' } },
      { status: 200, body: { envs: [] } },
      { status: 200, body: {} },
      { status: 200, body: { id: 'prj_new', name: 'my-project', link: { repoId: 42, defaultBranch: 'main' } } },
      { status: 500, body: { error: { message: 'boom' } } },              // POST deployment fails
    ])
    const out = await relinkVercelWithGitHub('tok', 'prj_old', 'org/repo')
    expect(out.vercel_deployment_id).toBeUndefined()
    expect(out.vercel_project_id).toBe('prj_new')
  })
})

describe('relinkVercelWithGitHub — secret redaction', () => {
  it('redacts the token out of a failed project-recreate response body', async () => {
    makeFetchSpy([
      { status: 200, body: { name: 'my-project' } }, // GET existing project
      { status: 200, body: { envs: [] } }, // GET env snapshot
      { status: 200, body: {} }, // DELETE old project
      { status: 500, body: 'internal error: leaked-vercel-token' }, // POST recreate fails
    ])
    await expect(
      relinkVercelWithGitHub('leaked-vercel-token', 'proj-1', 'org/repo'),
    ).rejects.toThrow(/\[REDACTED\]/)
  })
})

// ── triggerVercelDeployment ────────────────────────────────────────────────────

describe('triggerVercelDeployment', () => {
  it('returns the deployment url + id on the first successful ref', async () => {
    makeFetchSpy([
      { status: 200, body: { uid: 'dpl_1', url: 'my-proj-abc.vercel.app' } },
    ])
    const out = await triggerVercelDeployment('tok', {
      projectId: 'prj_1', resolvedName: 'my-proj', repoId: 42, defaultBranch: 'main',
    })
    expect(out.deploymentId).toBe('dpl_1')
    expect(out.projectUrl).toBe('https://my-proj-abc.vercel.app')
  })

  it('throws when NO ref deploys (no more phantom success with undefined id)', async () => {
    makeFetchSpy([
      { status: 500, body: { error: 'boom-main' } },
      { status: 500, body: { error: 'boom-master' } },
    ])
    await expect(
      triggerVercelDeployment('tok', { projectId: 'prj_1', resolvedName: 'my-proj', repoId: 42 }),
    ).rejects.toThrow(/could not be triggered/i)
  })

  it('throws RateLimitError on a 429 deployment response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 429, headers: { 'Retry-After': '20' } }),
    ))
    await expect(
      triggerVercelDeployment('tok', { projectId: 'prj_1', resolvedName: 'my-proj', repoId: 42, defaultBranch: 'main' }),
    ).rejects.toBeInstanceOf(RateLimitError)
    vi.restoreAllMocks()
  })
})

describe('redeployVercel — rate limit', () => {
  it('throws RateLimitError when the project fetch is rate limited', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 429, headers: { 'Retry-After': '10' } }),
    ))
    await expect(redeployVercel('tok', 'prj_x')).rejects.toBeInstanceOf(RateLimitError)
    vi.restoreAllMocks()
  })
})

describe('provisionVercel — vercelProjectId reuse path rate limit', () => {
  it('throws RateLimitError (no phantom success) when the project GET is rate limited', async () => {
    // Retry path: params.vercelProjectId set → the FIRST fetch is the project GET.
    // A 429 there previously fell through (getRes.ok false) leaving repoId undefined →
    // deploy skipped → returned a success shape with deploymentId undefined (phantom success).
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 429, headers: { 'Retry-After': '10' } }),
    ))
    await expect(
      provisionVercel('tok', 'my-proj', {}, { vercelProjectId: 'prj_x' }),
    ).rejects.toBeInstanceOf(RateLimitError)
    vi.restoreAllMocks()
  })
})

describe('getVercelDeploymentState', () => {
  it('returns readyState and url from a READY deployment', async () => {
    const calls = makeFetchSpy([
      { status: 200, body: { readyState: 'READY', url: 'my-app-abc.vercel.app' } },
    ])
    const res = await getVercelDeploymentState('tok', 'dpl_123')
    expect(calls[0].url).toBe('https://api.vercel.com/v13/deployments/dpl_123')
    expect(res).toEqual({ readyState: 'READY', url: 'my-app-abc.vercel.app' })
  })

  it('returns BUILDING while the deployment is still building', async () => {
    makeFetchSpy([{ status: 200, body: { readyState: 'BUILDING' } }])
    const res = await getVercelDeploymentState('tok', 'dpl_123')
    expect(res).toEqual({ readyState: 'BUILDING', url: null })
  })

  it('maps a 404 to UNKNOWN (deployment not visible yet)', async () => {
    makeFetchSpy([{ status: 404, body: { error: { code: 'not_found' } } }])
    const res = await getVercelDeploymentState('tok', 'dpl_missing')
    expect(res).toEqual({ readyState: 'UNKNOWN', url: null })
  })

  it('throws on a non-404 upstream error so the caller can surface 502', async () => {
    makeFetchSpy([{ status: 500, body: { error: 'boom' } }])
    await expect(getVercelDeploymentState('tok', 'dpl_123')).rejects.toThrow()
  })

  it('encodes the deployment id in the URL', async () => {
    const calls = makeFetchSpy([{ status: 200, body: { readyState: 'READY' } }])
    await getVercelDeploymentState('tok', 'dpl a/b')
    expect(calls[0].url).toBe('https://api.vercel.com/v13/deployments/dpl%20a%2Fb')
  })

  it('throws RateLimitError on a 429 from Vercel', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: 'rate limited' }), { status: 429, headers: { 'Retry-After': '20' } }),
    ))
    await expect(getVercelDeploymentState('tok', 'dpl_123')).rejects.toBeInstanceOf(RateLimitError)
    vi.restoreAllMocks()
  })
})
