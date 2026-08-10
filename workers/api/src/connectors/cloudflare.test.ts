import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  getAccountId,
  provisionR2,
  updateWorkerSecrets,
  deprovisionCloudflareWorker,
  deprovisionR2Bucket,
  deleteWorkerSecret,
  rollbackCloudflareWorker,
  signalMerge,
  addVercelDnsRecords,
} from './cloudflare'
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

/**
 * A fetch mock that actually honors `init.signal`: it never resolves/rejects
 * on its own (simulating an in-flight CF API call) and instead rejects with
 * an AbortError as soon as the passed signal aborts — exactly like the real
 * `fetch` implementation does. Used to prove that aborting the DO's signal
 * actually cancels in-flight connector calls, not just that a param exists.
 */
function makeAbortAwareFetchSpy() {
  const calls: FetchCall[] = []
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Promise((_resolve, reject) => {
      const signal = init?.signal as AbortSignal | undefined
      if (!signal) return // never resolves — test would hang/timeout if signal missing
      if (signal.aborted) {
        reject(new DOMException('The operation was aborted.', 'AbortError'))
        return
      }
      signal.addEventListener(
        'abort',
        () => reject(new DOMException('The operation was aborted.', 'AbortError')),
        { once: true },
      )
    })
  }))
  return calls
}

// ── getAccountId ──────────────────────────────────────────────────────────────

describe('getAccountId', () => {
  it('resolves the first account id on success', async () => {
    makeFetchSpy([{ status: 200, body: { result: [{ id: 'acc-123' }] } }])
    const id = await getAccountId('tok')
    expect(id).toBe('acc-123')
  })

  it('throws with "Account:Read permission" message on non-ok response', async () => {
    makeFetchSpy([{ status: 403, body: {} }])
    await expect(getAccountId('tok')).rejects.toThrow('Account:Read permission')
  })

  it('throws "No Cloudflare account found" when result array is empty', async () => {
    makeFetchSpy([{ status: 200, body: { result: [] } }])
    await expect(getAccountId('tok')).rejects.toThrow('No Cloudflare account found')
  })
})

// ── provisionR2 ───────────────────────────────────────────────────────────────

describe('provisionR2', () => {
  it('posts bucket with slugified name and returns all output keys including r2_access_key_id and R2_ACCESS_KEY_ID', async () => {
    makeFetchSpy([
      { status: 200, body: {} }, // bucket creation
      {
        status: 200,
        body: { result: { accessKeyId: 'AKI123', secretAccessKey: 'secret456' } },
      }, // token creation
    ])
    const output = await provisionR2('tok', 'acc-1', 'my-bucket')
    expect(output).toHaveProperty('r2_access_key_id', 'AKI123')
    expect(output).toHaveProperty('R2_ACCESS_KEY_ID', 'AKI123')
    expect(output).toHaveProperty('r2_bucket_name')
    expect(output).toHaveProperty('R2_BUCKET_NAME')
    expect(output).toHaveProperty('r2_endpoint')
    expect(output).toHaveProperty('R2_ENDPOINT')
    expect(output).toHaveProperty('r2_secret_access_key', 'secret456')
    expect(output).toHaveProperty('R2_SECRET_ACCESS_KEY', 'secret456')
  })

  it('treats 409 on bucket creation as idempotent and continues to token creation', async () => {
    const calls = makeFetchSpy([
      { status: 409, text: 'Conflict' }, // bucket already exists
      {
        status: 200,
        body: { result: { accessKeyId: 'AKI123', secretAccessKey: 'secret456' } },
      }, // token creation still proceeds
    ])
    await expect(provisionR2('tok', 'acc-1', 'existing-bucket')).resolves.toBeDefined()
    // Both bucket and token calls should have been made
    expect(calls).toHaveLength(2)
  })

  it('degrades gracefully when R2 token creation returns non-ok (e.g. 404/500)', async () => {
    makeFetchSpy([
      { status: 200, body: {} }, // bucket creation ok
      { status: 404, text: 'Not Found' }, // token endpoint not available
    ])
    const out = await provisionR2('tok', 'acc-1', 'my-bucket')
    expect(out.r2_credentials_pending).toBe(true)
    expect(out.R2_BUCKET_NAME).toBeTruthy()
    expect(out.R2_ENDPOINT).toBeTruthy()
    expect(out.R2_ACCESS_KEY_ID).toBe('')
    expect(out.R2_SECRET_ACCESS_KEY).toBe('')
  })

  it('degrades gracefully when R2 token response has empty credentials', async () => {
    makeFetchSpy([
      { status: 200, body: {} }, // bucket creation ok
      { status: 200, body: { result: {} } }, // token response missing credentials
    ])
    const out = await provisionR2('tok', 'acc-1', 'my-bucket')
    expect(out.r2_credentials_pending).toBe(true)
    expect(out.R2_BUCKET_NAME).toBeTruthy()
  })

  it('endpoint is constructed as https://{accountId}.r2.cloudflarestorage.com', async () => {
    makeFetchSpy([
      { status: 200, body: {} },
      {
        status: 200,
        body: { result: { accessKeyId: 'AKI123', secretAccessKey: 'secret456' } },
      },
    ])
    const output = await provisionR2('tok', 'my-account-id', 'my-bucket')
    expect(output.r2_endpoint).toBe('https://my-account-id.r2.cloudflarestorage.com')
    expect(output.R2_ENDPOINT).toBe('https://my-account-id.r2.cloudflarestorage.com')
  })
})

// ── deprovision ───────────────────────────────────────────────────────────────

describe('deprovision', () => {
  it('deprovisionCloudflareWorker calls DELETE with encodeURIComponent on worker name', async () => {
    const calls = makeFetchSpy([{ status: 200, body: {} }])
    await deprovisionCloudflareWorker('tok', 'acc-1', 'my worker/name')
    expect(calls).toHaveLength(1)
    expect((calls[0].init as RequestInit).method).toBe('DELETE')
    expect(calls[0].url).toContain(encodeURIComponent('my worker/name'))
    expect(calls[0].url).toContain('/accounts/acc-1/workers/scripts/')
  })

  it('deprovisionR2Bucket calls DELETE on the correct bucket URL', async () => {
    const calls = makeFetchSpy([{ status: 200, body: {} }])
    await deprovisionR2Bucket('tok', 'acc-1', 'my-bucket')
    expect(calls).toHaveLength(1)
    expect((calls[0].init as RequestInit).method).toBe('DELETE')
    expect(calls[0].url).toContain('/accounts/acc-1/r2/buckets/')
    expect(calls[0].url).toContain(encodeURIComponent('my-bucket'))
  })

  it('deleteWorkerSecret redacts the token out of a failed response body', async () => {
    makeFetchSpy([{ status: 403, text: 'unauthorized: cf-secret-token' }])
    await expect(
      deleteWorkerSecret('cf-secret-token', 'acc-1', 'my-worker', 'API_KEY'),
    ).rejects.toThrow(/\[REDACTED\]/)
  })
})

// ── updateWorkerSecrets ───────────────────────────────────────────────────────

describe('updateWorkerSecrets — secret redaction', () => {
  it('redacts the pushed secret value out of a failed response body before logging', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    makeFetchSpy([{ status: 400, text: 'invalid: sk-leaked-secret-value' }])

    await expect(
      updateWorkerSecrets('tok', 'acc-1', 'my-worker', { API_KEY: 'sk-leaked-secret-value' }),
    ).rejects.toThrow('CF secret push failed for')

    const logged = errorSpy.mock.calls.map((c) => JSON.stringify(c)).join('\n')
    expect(logged).not.toContain('sk-leaked-secret-value')
    expect(logged).toContain('[REDACTED]')
  })
})

// ── rollbackCloudflareWorker ──────────────────────────────────────────────────

describe('rollbackCloudflareWorker', () => {
  it('returns ok:true when success:true', async () => {
    makeFetchSpy([{ status: 200, body: { success: true, errors: [] } }])
    const result = await rollbackCloudflareWorker('tok', 'acc-1', 'my-worker', 'v-abc')
    expect(result).toEqual({ ok: true })
  })

  it('returns ok:false with message on 404', async () => {
    makeFetchSpy([{ status: 404, body: {} }])
    const result = await rollbackCloudflareWorker('tok', 'acc-1', 'missing-worker', 'v-abc')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not found/i)
  })

  it('returns ok:false with CF error message on errors array', async () => {
    makeFetchSpy([{ status: 200, body: { success: false, errors: [{ message: 'version not deployable' }] } }])
    const result = await rollbackCloudflareWorker('tok', 'acc-1', 'my-worker', 'v-bad')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('version not deployable')
  })
})

// ── getCloudflareObservability ────────────────────────────────────────────────

import { describe as describe2, it as it2, expect as expect2, vi as vi2, beforeEach as beforeEach2 } from "vitest";
import { getCloudflareObservability } from "./cloudflare";

describe2("getCloudflareObservability", () => {
  beforeEach2(() => { vi2.restoreAllMocks(); });

  it2("returns computed metrics from GraphQL response", async () => {
    vi2.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        data: {
          viewer: {
            accounts: [{
              workersInvocationsAdaptiveGroups: [{
                sum: { requests: 1000, errors: 50 },
                quantiles: { cpuTimeP50: 2000, cpuTimeP99: 8000 },
              }],
            }],
          },
        },
      }), { status: 200 }),
    );

    const result = await getCloudflareObservability("tok", "acc123", "my-worker");
    expect2(result).toEqual({
      status: "ok",
      requests24h: 1000,
      errorRate: 0.05,       // 50 / 1000
      cpuP50Ms: 2,           // 2000 µs → 2 ms
      cpuP99Ms: 8,           // 8000 µs → 8 ms
    });
  });

  it2("returns error status on non-ok response", async () => {
    vi2.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("", { status: 500 }),
    );
    const result = await getCloudflareObservability("tok", "acc123", "worker");
    expect2(result).toEqual({ status: "error" });
  });

  it2("returns 0 errorRate when requests is 0", async () => {
    vi2.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        data: {
          viewer: {
            accounts: [{
              workersInvocationsAdaptiveGroups: [],
            }],
          },
        },
      }), { status: 200 }),
    );
    const result = await getCloudflareObservability("tok", "acc", "w");
    expect2(result).toMatchObject({ status: "ok", requests24h: 0, errorRate: 0 });
  });
});

// ── parseWorkerErrorsResponse ─────────────────────────────────────────────────

import { parseWorkerErrorsResponse } from './cloudflare'

describe("parseWorkerErrorsResponse", () => {
  it("sums errors and requests from a normal response", () => {
    const json = {
      data: {
        viewer: {
          accounts: [
            {
              workersInvocationsAdaptiveGroups: [
                { sum: { errors: 3, requests: 100 } },
                { sum: { errors: 2, requests: 50 } },
              ],
            },
          ],
        },
      },
    };
    expect(parseWorkerErrorsResponse(json)).toEqual({
      status: "ok",
      errorCount: 5,
      requestCount: 150,
    });
  });

  it("returns ok/zero when the account has no invocation groups", () => {
    const json = {
      data: { viewer: { accounts: [{ workersInvocationsAdaptiveGroups: [] }] } },
    };
    expect(parseWorkerErrorsResponse(json)).toEqual({
      status: "ok",
      errorCount: 0,
      requestCount: 0,
    });
  });

  it("returns unauthorized when GraphQL reports an auth/permission error", () => {
    const json = {
      data: null,
      errors: [{ message: "Authentication error: insufficient permissions" }],
    };
    expect(parseWorkerErrorsResponse(json)).toEqual({ status: "unauthorized" });
  });

  it("returns error for a non-permission GraphQL error", () => {
    const json = { data: null, errors: [{ message: "rate limited" }] };
    expect(parseWorkerErrorsResponse(json)).toEqual({ status: "error" });
  });

  it("returns error for a malformed payload", () => {
    expect(parseWorkerErrorsResponse(null)).toEqual({ status: "error" });
    expect(parseWorkerErrorsResponse({ data: {} })).toEqual({ status: "error" });
  });
});

// ── abort-signal threading (P0.3) ───────────────────────────────────────────
//
// These tests use an abort-aware fetch mock that never resolves on its own
// (simulating a stuck/in-flight CF API call) and only rejects once the signal
// passed to it fires. This proves the caller-supplied signal is actually
// wired into the fetch call — not just accepted as an unused parameter.

describe('abort-signal threading', () => {
  it('getAccountId rejects with AbortError when the caller signal is already aborted', async () => {
    makeAbortAwareFetchSpy()
    const controller = new AbortController()
    controller.abort()
    await expect(
      getAccountId('tok', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('getAccountId rejects with AbortError when the caller signal aborts mid-flight', async () => {
    makeAbortAwareFetchSpy()
    const controller = new AbortController()
    const promise = getAccountId('tok', { signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('provisionR2 rejects with AbortError when the caller signal aborts mid-flight (bucket-create call)', async () => {
    makeAbortAwareFetchSpy()
    const controller = new AbortController()
    const promise = provisionR2('tok', 'acc-1', 'my-bucket', {
      signal: controller.signal,
    })
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('updateWorkerSecrets rejects with AbortError when the caller signal aborts mid-flight', async () => {
    makeAbortAwareFetchSpy()
    const controller = new AbortController()
    const promise = updateWorkerSecrets(
      'tok',
      'acc-1',
      'my-worker',
      { SECRET_A: 'value-a' },
      { signal: controller.signal },
    )
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('calls without an opts.signal are unaffected — still complete normally against a 30s-timeout-only signal', async () => {
    makeFetchSpy([{ status: 200, body: { result: [{ id: 'acc-123' }] } }])
    const id = await getAccountId('tok')
    expect(id).toBe('acc-123')
  })
})

describe('signalMerge fallback (AbortSignal.any unavailable)', () => {
  it('falls back to manual combination and still forwards abort from the caller signal', async () => {
    const originalAny = AbortSignal.any
    // @ts-expect-error simulate a runtime without AbortSignal.any
    delete AbortSignal.any
    try {
      expect(typeof AbortSignal.any).toBe('undefined')
      const controller = new AbortController()
      const merged = signalMerge(controller.signal)
      expect(merged.aborted).toBe(false)
      controller.abort()
      expect(merged.aborted).toBe(true)
    } finally {
      AbortSignal.any = originalAny
    }
  })

  it('falls back correctly when the caller signal is already aborted at merge time', () => {
    const originalAny = AbortSignal.any
    // @ts-expect-error simulate a runtime without AbortSignal.any
    delete AbortSignal.any
    try {
      const controller = new AbortController()
      controller.abort()
      const merged = signalMerge(controller.signal)
      expect(merged.aborted).toBe(true)
    } finally {
      AbortSignal.any = originalAny
    }
  })

  it('with no caller signal, returns a (non-aborted) timeout-only signal regardless of AbortSignal.any availability', () => {
    const originalAny = AbortSignal.any
    // @ts-expect-error simulate a runtime without AbortSignal.any
    delete AbortSignal.any
    try {
      const merged = signalMerge(undefined)
      expect(merged.aborted).toBe(false)
    } finally {
      AbortSignal.any = originalAny
    }
  })
})

describe('addVercelDnsRecords — error visibility', () => {
  // findZoneId issues a GET first; return a zone, then drive record POSTs.
  it('records non-409 failures in the failed[] array instead of swallowing them', async () => {
    const seq = [
      { status: 200, body: { result: [{ id: 'zone-1' }] } }, // findZoneId
      { status: 500, body: { errors: ['boom'] } },           // A record POST fails
    ]
    let i = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      const r = seq[Math.min(i++, seq.length - 1)]
      return new Response(JSON.stringify(r.body), { status: r.status })
    }))
    const res = await addVercelDnsRecords('tok', 'example.com', undefined, [])
    expect(res.failed).toContain('example.com (500)')
    vi.unstubAllGlobals()
  })

  it('throws RateLimitError when a record POST is rate limited', async () => {
    const seq = [
      { status: 200, body: { result: [{ id: 'zone-1' }] } }, // findZoneId
      { status: 429, body: {}, headers: { 'Retry-After': '15' } }, // POST 429
    ]
    let i = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      const r = seq[Math.min(i++, seq.length - 1)] as any
      return new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers })
    }))
    await expect(
      addVercelDnsRecords('tok', 'example.com', undefined, []),
    ).rejects.toBeInstanceOf(RateLimitError)
    vi.unstubAllGlobals()
  })
})

