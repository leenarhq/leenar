import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  generatePassword,
  provisionSupabase,
  configureSupabaseAuth,
  deprovisionSupabase,
  applySupabaseSchema,
  applySchemaMutation,
} from './supabase'
import { buildMutationDDL, type SchemaMutation } from '../schema/supabaseSchema'

describe('generatePassword', () => {
  it('generates a 24-character password', () => {
    expect(generatePassword()).toHaveLength(24)
  })

  it('generates different passwords each time', () => {
    const a = generatePassword()
    const b = generatePassword()
    const c = generatePassword()
    // Extremely unlikely all three are the same
    expect(new Set([a, b, c]).size).toBeGreaterThan(1)
  })

  it('only uses safe characters (no ambiguous chars like 0, O, I, l, 1)', () => {
    // Run many times to increase character coverage
    const passwords = Array.from({ length: 50 }, generatePassword).join('')
    // Should not contain ambiguous chars that were excluded from charset
    expect(passwords).not.toMatch(/[0OIl1]/)
  })

  it('contains characters from multiple char classes', () => {
    const allPasswords = Array.from({ length: 10 }, generatePassword).join('')
    expect(allPasswords).toMatch(/[A-Z]/)
    expect(allPasswords).toMatch(/[a-z]/)
    expect(allPasswords).toMatch(/[2-9]/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// provisionSupabase — cancel signal propagation & error handling (6 cases)
// ─────────────────────────────────────────────────────────────────────────────
// NOTE: The status poll URL is `/v1/projects/${ref}` (no /status suffix).
// Production code reads project.ref (not project.id) from createRes.
// ─────────────────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => vi.unstubAllGlobals());

describe("provisionSupabase", () => {
  it("happy path: returns output without creating a project when listRes finds an existing match", async () => {
    // Uses fake timers because the polling loop starts with a 5s sleep even for existing projects
    vi.useFakeTimers();

    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          const u = String(url);
          if (u.includes("/organizations")) return json([{ id: "org-1" }]);
          // listRes returns a match — no create should happen
          if (u.endsWith("/projects") && !init?.method) {
            return json([{ ref: "existing-ref", name: "test-project", status: "ACTIVE_HEALTHY" }]);
          }
          // Poll status: /v1/projects/existing-ref (no /api-keys)
          if (u.includes("existing-ref") && !u.includes("/api-keys")) {
            return json({ status: "ACTIVE_HEALTHY" });
          }
          if (u.includes("existing-ref") && u.includes("/api-keys")) {
            return json([
              { name: "anon", api_key: "anon-k" },
              { name: "service_role", api_key: "svc-k" },
            ]);
          }
          return json({});
        }),
      );

      const fetchSpy = vi.mocked(fetch);
      const prom = provisionSupabase("token", "test-project");

      // Drain microtasks: org fetch → list fetch complete
      for (let i = 0; i < 20; i++) await Promise.resolve();
      // Advance past the polling sleep (5s)
      await vi.runAllTimersAsync();

      const result = await prom;

      expect(result.supabase_project_ref).toBe("existing-ref");
      const postCalls = (fetchSpy.mock.calls as [string, RequestInit | undefined][]).filter(
        ([, init]) => init?.method === "POST",
      );
      expect(postCalls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an already-ACTIVE_HEALTHY existing project skips the status poll entirely — no sleep, no status GET", async () => {
    // The project listing already reports `status`, so re-polling a project it
    // just told us is healthy costs a full poll interval of dead wall-clock on
    // every redeploy. Settle without advancing a single timer.
    vi.useFakeTimers();

    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          const u = String(url);
          if (u.includes("/organizations")) return json([{ id: "org-1" }]);
          if (u.endsWith("/projects") && !init?.method) {
            return json([
              { ref: "existing-ref", name: "test-project", status: "ACTIVE_HEALTHY" },
            ]);
          }
          if (u.includes("existing-ref") && u.includes("/api-keys")) {
            return json([
              { name: "anon", api_key: "anon-k" },
              { name: "service_role", api_key: "svc-k" },
            ]);
          }
          return json({});
        }),
      );

      const fetchSpy = vi.mocked(fetch);
      let settled = false;
      const prom = provisionSupabase("token", "test-project").then((r) => {
        settled = true;
        return r;
      });

      // Microtasks only — no timer advancement.
      for (let i = 0; i < 50; i++) await Promise.resolve();

      expect(settled).toBe(true);
      const result = await prom;
      expect(result.supabase_project_ref).toBe("existing-ref");

      const statusPolls = (fetchSpy.mock.calls as [string, RequestInit | undefined][]).filter(
        ([u]) => String(u).includes("existing-ref") && !String(u).includes("/api-keys"),
      );
      expect(statusPolls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an existing project that is NOT healthy still polls — and checks before sleeping", async () => {
    vi.useFakeTimers();

    try {
      let statusPolls = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          const u = String(url);
          if (u.includes("/organizations")) return json([{ id: "org-1" }]);
          if (u.endsWith("/projects") && !init?.method) {
            // Listed as still coming up — the poll loop must run.
            return json([
              { ref: "existing-ref", name: "test-project", status: "COMING_UP" },
            ]);
          }
          if (u.includes("existing-ref") && u.includes("/api-keys")) {
            return json([
              { name: "anon", api_key: "anon-k" },
              { name: "service_role", api_key: "svc-k" },
            ]);
          }
          if (u.includes("existing-ref")) {
            statusPolls++;
            return json({ status: "ACTIVE_HEALTHY" });
          }
          return json({});
        }),
      );

      const prom = provisionSupabase("token", "test-project");

      // No timer advancement: the first status check must happen up front.
      for (let i = 0; i < 50; i++) await Promise.resolve();
      expect(statusPolls).toBe(1);

      await vi.runAllTimersAsync();
      const result = await prom;
      expect(result.supabase_project_ref).toBe("existing-ref");
      // Healthy on the very first check → exactly one poll, no extra rounds.
      expect(statusPolls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws when cancelSignal is already aborted before listRes — no create POST fires", async () => {
    const controller = new AbortController();
    controller.abort(); // pre-aborted

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      // fetch should throw AbortError when signal is aborted
      if (init?.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      if (String(url).includes("/organizations")) return json([{ id: "org-1" }]);
      return json([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      provisionSupabase("token", "test-project", {}, controller.signal),
    ).rejects.toThrow();

    const postCalls = (fetchMock.mock.calls as [string, RequestInit | undefined][]).filter(
      ([, init]) => init?.method === "POST",
    );
    expect(postCalls).toHaveLength(0);
  });

  it("throws 'cancelled' via explicit aborted check between listRes and createRes — POST never fires", async () => {
    const controller = new AbortController();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes("/organizations")) return json([{ id: "org-1" }]);
        if (u.endsWith("/projects") && !init?.method) {
          // listRes: no existing project found → would normally trigger create.
          // Abort the signal AFTER listRes returns so the explicit
          // `if (cancelSignal?.aborted) throw` guard catches it.
          controller.abort();
          return json([]); // no match
        }
        // POST should never be reached
        if (init?.method === "POST") return json({ ref: "new-ref" }, 201);
        return json({});
      }),
    );

    await expect(
      provisionSupabase("token", "test-project", {}, controller.signal),
    ).rejects.toThrow(/cancelled/i);

    const fetchMock = vi.mocked(fetch);
    const postCalls = (fetchMock.mock.calls as [string, RequestInit | undefined][]).filter(
      ([, init]) => (init as RequestInit)?.method === "POST",
    );
    expect(postCalls).toHaveLength(0);
  });

  it("throws 'cancelled' when signal aborts during the polling sleep", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();

    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          const u = String(url);
          if (u.includes("/organizations")) return json([{ id: "org-1" }]);
          if (u.endsWith("/projects") && !init?.method) return json([]); // no existing
          if (u.endsWith("/projects") && init?.method === "POST") {
            // Return ref (not id) — production code reads project.ref
            return json({ ref: "new-ref", name: "test-project" }, 201);
          }
          // Polling: status never becomes ACTIVE_HEALTHY
          return json({ status: "COMING_UP" });
        }),
      );

      const prom = provisionSupabase("token", "test-project", {}, controller.signal);

      // Drain microtasks: org fetch → list fetch → create fetch all resolve via Promises
      for (let i = 0; i < 20; i++) await Promise.resolve();

      // Now code is suspended in the polling sleep (setTimeout 5_000).
      // Aborting fires the abort event listener synchronously → sleep promise rejects.
      controller.abort();

      await expect(prom).rejects.toThrow(/cancelled/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws when Supabase Organizations API returns non-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/organizations")) return json({ message: "Unauthorized" }, 401);
        return json([]);
      }),
    );

    await expect(provisionSupabase("bad-token", "test-project")).rejects.toThrow(
      /401|organization|unauthorized/i,
    );
  });

  it("throws with quota message when project creation returns 403", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes("/organizations")) return json([{ id: "org-1" }]);
        if (u.endsWith("/projects") && !init?.method) return json([]);
        if (init?.method === "POST") {
          return json({ message: "You have reached the free project limit" }, 403);
        }
        return json({});
      }),
    );

    await expect(
      provisionSupabase("token", "test-project"),
    ).rejects.toThrow(/limit|upgrade|quota/i);
  });
});

describe("configureSupabaseAuth", () => {
  it("redacts the smtpPass value out of a failed config response's error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ message: "invalid smtp_pass: resend-api-key-12345" }, 400),
      ),
    );

    await expect(
      configureSupabaseAuth("token", "ref-1", {
        siteUrl: "https://example.com",
        smtpHost: "smtp.resend.com",
        smtpPass: "resend-api-key-12345",
        smtpSenderEmail: "noreply@example.com",
      }),
    ).rejects.toThrow(/Supabase auth config failed: invalid smtp_pass: \[REDACTED\]/);
  });

  it("redacts the management token out of a failed config response's error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ message: "invalid token: mgmt-token-xyz" }, 401)),
    );

    await expect(
      configureSupabaseAuth("mgmt-token-xyz", "ref-1", {
        siteUrl: "https://example.com",
      }),
    ).rejects.toThrow(/Supabase auth config failed: invalid token: \[REDACTED\]/);
  });

  it("does not redact siteUrl — it's a public value, not a secret", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ message: "invalid redirect: https://example.com" }, 400)),
    );

    await expect(
      configureSupabaseAuth("token", "ref-1", { siteUrl: "https://example.com" }),
    ).rejects.toThrow(/Supabase auth config failed: invalid redirect: https:\/\/example\.com/);
  });
});

describe("deprovisionSupabase — secret redaction", () => {
  it("redacts the management token out of a failed delete response's error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ message: "invalid token: delete-token-abc" }, 401)),
    );

    await expect(
      deprovisionSupabase("delete-token-abc", { supabase_project_ref: "ref-1" }),
    ).rejects.toThrow(/Supabase project delete failed: invalid token: \[REDACTED\]/);
  });
});

describe("applySupabaseSchema — secret redaction", () => {
  const TABLES = [{ name: "widgets", columns: [{ name: "title", type: "text" as const }] }];

  it("applySupabaseSchema redacts the management token out of a failed DDL response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ message: "invalid token: schema-token-1" }, 401)),
    );

    await expect(
      applySupabaseSchema("schema-token-1", "ref-1", TABLES as any),
    ).rejects.toThrow(/Supabase schema apply failed: invalid token: \[REDACTED\]/);
  });
});

describe('applySupabaseSchema — bounded fetch', () => {
  it('always passes a signal to the query fetch (no unbounded request)', async () => {
    let sawSignal = false
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      sawSignal = !!init?.signal
      return new Response(JSON.stringify({}), { status: 200 })
    }))
    await applySupabaseSchema('token', 'abcdefghijklmnopqrst', [
      { name: 't', columns: [{ name: 'title', type: 'text' }] } as any,
    ])
    expect(sawSignal).toBe(true)
    vi.unstubAllGlobals()
  })

  it('propagates a caller cancel signal to the fetch', async () => {
    const controller = new AbortController()
    let passed: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      passed = init?.signal ?? undefined
      return new Response(JSON.stringify({}), { status: 200 })
    }))
    await applySupabaseSchema('token', 'abcdefghijklmnopqrst', [
      { name: 't', columns: [{ name: 'title', type: 'text' }] } as any,
    ], controller.signal)
    expect(passed).toBe(controller.signal)
    vi.unstubAllGlobals()
  })
})

describe('applySchemaMutation', () => {
  // runQuery (which executeSql calls under the hood) posts to
  // /v1/projects/:ref/database/query with { query: sql }. mode="write"
  // sends the DDL as-is (no BEGIN/READ ONLY/ROLLBACK wrapper).
  function captureQueryFetch() {
    let capturedBody: any = null
    let capturedUrl: string | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        capturedUrl = String(url)
        capturedBody = init?.body ? JSON.parse(init.body as string) : null
        return new Response(JSON.stringify([]), { status: 200 })
      }),
    )
    return {
      get url() {
        return capturedUrl
      },
      get body() {
        return capturedBody
      },
    }
  }

  beforeEach(() => vi.unstubAllGlobals())

  it('sends the exact DDL from buildMutationDDL in write mode (addColumn)', async () => {
    const capture = captureQueryFetch()
    const m: SchemaMutation = {
      kind: 'addColumn',
      table: 'post',
      column: { name: 'title', type: 'text', nullable: false },
    }
    const expectedDdl = buildMutationDDL(m)
    expect(expectedDdl).toBe(
      'ALTER TABLE "post" ADD COLUMN IF NOT EXISTS "title" text NOT NULL;',
    )

    await applySchemaMutation('token', 'abcdefghijklmnopqrst', m)

    expect(capture.url).toBe(
      'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/database/query',
    )
    // write mode: no BEGIN/READ ONLY/ROLLBACK wrapper — sql sent verbatim
    expect(capture.body).toEqual({ query: expectedDdl })
    vi.unstubAllGlobals()
  })

  it('passes destructive kinds (dropTable) through to executeSql write mode with no gating', async () => {
    const capture = captureQueryFetch()
    const m: SchemaMutation = { kind: 'dropTable', table: 'post' }
    const expectedDdl = buildMutationDDL(m)
    expect(expectedDdl).toBe('DROP TABLE IF EXISTS "post";')

    await applySchemaMutation('token', 'abcdefghijklmnopqrst', m)

    expect(capture.body).toEqual({ query: expectedDdl })
    vi.unstubAllGlobals()
  })

  it('throws before calling executeSql when the mutation is invalid (reserved column)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const m: SchemaMutation = { kind: 'dropColumn', table: 'post', column: 'id' }

    await expect(applySchemaMutation('token', 'abcdefghijklmnopqrst', m)).rejects.toThrow(
      /reserved/i,
    )
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('returns the QueryResult from executeSql', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([{ a: 1 }]), { status: 200 })),
    )
    const m: SchemaMutation = { kind: 'setRls', table: 'post', enabled: true }
    const result = await applySchemaMutation('token', 'abcdefghijklmnopqrst', m)
    expect(result).toEqual({
      columns: ['a'],
      rows: [[1]],
      rowCount: 1,
      truncated: false,
    })
    vi.unstubAllGlobals()
  })
})
