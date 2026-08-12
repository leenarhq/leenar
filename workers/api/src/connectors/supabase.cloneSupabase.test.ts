import { describe, it, expect, vi, beforeEach } from "vitest";
import { cloneSupabase } from "./supabase";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => vi.unstubAllGlobals());

/**
 * Stubs the full fetch surface cloneSupabase's happy path touches:
 *  1. provisionSupabase: /organizations, /projects (list — returns an
 *     existing match so no create/poll/sleep is needed), /projects/:ref
 *     (status poll skipped because listRes already matched), /api-keys.
 *  2. introspectSchema(sourceRef): 7 catalog queries dispatched via
 *     Promise.all in FIXED order (columns, pks, uniques, fks, indexes, rls,
 *     policies) — see supabase.introspect.test.ts for the established
 *     pattern.
 *  3. Any other /database/query POST (DDL apply to the clone ref, or a
 *     seed query) is captured into `queryCalls` keyed by which project ref
 *     the URL targets, so assertions can distinguish "applied to clone" vs
 *     "read from source".
 */
function stubCloneFetch(opts: {
  cloneRef: string;
  introspectRows: unknown[][];
  seedSourceRows?: Record<string, unknown>[];
}) {
  const { cloneRef, introspectRows, seedSourceRows } = opts;
  let introspectCallIndex = 0;
  const queryCalls: Array<{ url: string; query: string }> = [];

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);

    if (u.includes("/organizations")) return json([{ id: "org-1" }]);

    // provisionSupabase's list call — return an existing match so no
    // create/poll/sleep path is exercised (keeps the test fast/deterministic).
    if (u.endsWith("/projects") && !init?.method) {
      return json([{ ref: cloneRef, name: "clone-project", status: "ACTIVE_HEALTHY" }]);
    }

    if (u.includes(`/projects/${cloneRef}/api-keys`)) {
      return json([
        { name: "anon", api_key: "anon-k" },
        { name: "service_role", api_key: "svc-k" },
      ]);
    }

    // provisionSupabase's status poll: GET /v1/projects/:ref (no /api-keys,
    // no /database/query suffix) — report ACTIVE_HEALTHY immediately so the
    // poll loop exits after its first (fake-timer-advanced) iteration.
    if (u.endsWith(`/projects/${cloneRef}`)) {
      return json({ status: "ACTIVE_HEALTHY" });
    }

    // database/query POST: either one of introspectSchema's 6 fixed-order
    // catalog queries (against sourceRef), the DDL apply (against cloneRef),
    // or a seed query.
    if (u.includes("/database/query") && init?.method === "POST") {
      const body = init.body ? JSON.parse(init.body as string) : {};
      const q = String(body.query ?? "");

      // introspectSchema issues exactly 7 queries against sourceRef, each
      // matched by a distinguishing keyword from introspectSchema's SQL.
      const introspectMarkers = [
        "information_schema.columns",
        "constraint_type='PRIMARY KEY'",
        "constraint_type='UNIQUE'",
        "constraint_type='FOREIGN KEY'",
        "pg_indexes",
        "relrowsecurity",
        "pg_policies",
      ];
      const marker = introspectMarkers.find((m) => q.includes(m));
      if (marker) {
        const idx = introspectCallIndex++;
        return json(introspectRows[idx] ?? []);
      }

      // Seed read from source: `select to_jsonb(t) as row from public."name" ...`
      if (q.includes("to_jsonb(t) as row")) {
        return json((seedSourceRows ?? []).map((row) => ({ row })));
      }

      queryCalls.push({ url: u, query: q });
      return json([]);
    }

    return json({});
  });

  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, queryCalls };
}

/**
 * provisionSupabase's poll loop always sleeps 5s once (setTimeout) before its
 * first status check, even when the project already exists — see the
 * "happy path" test in supabase.test.ts for the established fake-timer
 * pattern this mirrors (drain microtasks, then vi.runAllTimersAsync()).
 */
async function runClone<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const prom = fn();
    // Attach a no-op rejection handler immediately so a rejection that
    // settles during vi.runAllTimersAsync() below (before the real `await
    // prom` at the end of this function) isn't briefly "unhandled" from
    // Node's perspective — pure timing artifact of fake timers, not a bug.
    prom.catch(() => {});
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await vi.runAllTimersAsync();
    return await prom;
  } finally {
    vi.useRealTimers();
  }
}

const LIVE_SCHEMA_ROWS = (): unknown[][] => [
  // columns — includes `nickname` (missing from authored seed) and `ip inet`
  // (headline: unknown/raw-SQL type not in the editor's TableDef vocabulary)
  [
    { table_name: "users", column_name: "id", data_type: "uuid", is_nullable: "NO", column_default: "gen_random_uuid()" },
    { table_name: "users", column_name: "email", data_type: "text", is_nullable: "NO", column_default: null },
    { table_name: "users", column_name: "nickname", data_type: "text", is_nullable: "YES", column_default: null },
    { table_name: "users", column_name: "ip", data_type: "inet", is_nullable: "YES", column_default: null },
  ],
  // primary keys
  [{ table_name: "users", column_name: "id" }],
  // uniques
  [{ table_name: "users", column_name: "email" }],
  // foreign keys
  [],
  // indexes
  [
    { tablename: "users", indexname: "users_pkey", indexdef: "CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)" },
    { tablename: "users", indexname: "users_email_key", indexdef: "CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email)" },
  ],
  // rls
  [{ table_name: "users", rls_enabled: true }],
  // policies
  [],
];

describe("cloneSupabase — live-schema clone", () => {
  it("REGRESSION: applies DDL built from the LIVE schema (introspection), not from authored params.tables — nickname + inet survive even though missing from the authored seed", async () => {
    const { fetchMock, queryCalls } = stubCloneFetch({
      cloneRef: "clone-ref",
      introspectRows: LIVE_SCHEMA_ROWS(),
    });

    // Authored seed is MISSING `nickname` and has no `ip` column at all —
    // if the clone used this authored seed, neither would appear in the DDL.
    const authoredTables = [
      { name: "users", columns: [{ name: "email", type: "text" as const }] },
    ];

    const out = await runClone(() =>
      cloneSupabase("token", {
        projectName: "clone-project",
        tables: authoredTables as any,
        sourceRef: "source-ref",
      }),
    );

    expect(out.cloned).toBe(true);
    expect(out.supabase_project_ref).toBe("clone-ref");

    // Exactly one DDL apply should have landed on the CLONE ref.
    expect(queryCalls).toHaveLength(1);
    const applied = queryCalls[0];
    expect(applied.url).toContain("/projects/clone-ref/database/query");
    expect(applied.query).toContain('CREATE TABLE IF NOT EXISTS public."users"');
    expect(applied.query).toContain('"nickname" text');
    expect(applied.query).toContain('"ip" inet');

    // The authored-only path (applySupabaseSchema against params.tables) was
    // NOT used: no query in the entire call history builds DDL that both (a)
    // targets the clone ref via applySupabaseSchema's buildDDL shape (which
    // always appends a `created_at` column + auto id) is absent here — the
    // introspected DDL has no such auto-injection, so `created_at` should
    // NOT appear (the live schema in this test has no created_at column).
    expect(applied.query).not.toContain("created_at");

    // Sanity: fetch was actually exercised for org/list/keys/introspect/apply.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(5);
  });

  it("does not call applySupabaseSchema's authored-tables path when sourceRef is present (only the live-introspected DDL is applied)", async () => {
    const { queryCalls } = stubCloneFetch({
      cloneRef: "clone-ref",
      introspectRows: LIVE_SCHEMA_ROWS(),
    });

    const authoredTables = [
      { name: "users", columns: [{ name: "email", type: "text" as const }] },
      { name: "orphan_authored_table", columns: [{ name: "x", type: "text" as const }] },
    ];

    await runClone(() =>
      cloneSupabase("token", {
        projectName: "clone-project",
        tables: authoredTables as any,
        sourceRef: "source-ref",
      }),
    );

    // Only ONE DDL statement batch landed on the clone (the live-schema
    // build). If the authored-only fallback had also run, we'd see a second
    // query, and/or `orphan_authored_table` (which doesn't exist in the live
    // schema) would appear in the applied DDL.
    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0].query).not.toContain("orphan_authored_table");
  });

  it("back-compat fallback: applies the authored TableDef[] via applySupabaseSchema when sourceRef is ABSENT", async () => {
    const { queryCalls } = stubCloneFetch({
      cloneRef: "clone-ref",
      introspectRows: [],
    });

    const authoredTables = [
      { name: "widgets", columns: [{ name: "title", type: "text" as const }] },
    ];

    const out = await runClone(() =>
      cloneSupabase("token", {
        projectName: "clone-project",
        tables: authoredTables as any,
        // no sourceRef
      }),
    );

    expect(out.cloned).toBe(true);
    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0].query).toContain('CREATE TABLE IF NOT EXISTS "widgets"');
  });

  it("propagates introspectSchema errors uncaught (does not fall back to a schemaless clone)", async () => {
    let queryCallCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes("/organizations")) return json([{ id: "org-1" }]);
        if (u.endsWith("/projects") && !init?.method)
          return json([{ ref: "clone-ref", name: "clone-project", status: "ACTIVE_HEALTHY" }]);
        if (u.includes("/api-keys"))
          return json([{ name: "anon", api_key: "a" }, { name: "service_role", api_key: "s" }]);
        if (u.endsWith("/projects/clone-ref")) return json({ status: "ACTIVE_HEALTHY" });
        if (u.includes("/database/query")) {
          queryCallCount++;
          // introspectSchema dispatches 7 catalog queries via Promise.all
          // (eagerly, left-to-right — see introspectSchema's doc comment).
          // Only fail the FIRST one: failing all seven would each reject
          // independently, and Promise.all only awaits/propagates the
          // first rejection, leaving the rest as unhandled-rejection noise
          // in the test run. One failing query is sufficient to prove the
          // throw propagates out of cloneSupabase uncaught.
          if (queryCallCount === 1) return json({ message: "db error" }, 500);
          return json([]);
        }
        return json({});
      }),
    );

    await expect(
      runClone(() =>
        cloneSupabase("token", {
          projectName: "clone-project",
          tables: [{ name: "users", columns: [] }] as any,
          sourceRef: "source-ref",
        }),
      ),
    ).rejects.toThrow();
    expect(queryCallCount).toBeGreaterThan(0);
  });

  it("seeds bounded row data from the LIVE tables (name-derived) when seedData + sourceRef are set, capped at SEED_ROW_CAP", async () => {
    const manyRows = Array.from({ length: 1500 }, (_, i) => ({ id: i, email: `u${i}@x.com` }));
    const { fetchMock } = stubCloneFetch({
      cloneRef: "clone-ref",
      introspectRows: LIVE_SCHEMA_ROWS(),
      seedSourceRows: manyRows,
    });

    await runClone(() =>
      cloneSupabase("token", {
        projectName: "clone-project",
        tables: [{ name: "users", columns: [{ name: "email", type: "text" as const }] }] as any,
        sourceRef: "source-ref",
        seedData: true,
      }),
    );

    // Find the insert-into-clone call and check the payload row count is capped.
    const insertCall = fetchMock.mock.calls.find(([url, init]: any) => {
      if (!String(url).includes(`/projects/clone-ref/database/query`)) return false;
      const body = init?.body ? JSON.parse(init.body) : {};
      return String(body.query ?? "").includes("jsonb_populate_recordset");
    });
    expect(insertCall).toBeTruthy();
    const body = JSON.parse((insertCall as any)[1].body);
    const match = /'(\[.*\])'::jsonb/.exec(body.query);
    expect(match).toBeTruthy();
    const payload = JSON.parse((match as RegExpExecArray)[1].replace(/''/g, "'"));
    expect(payload.length).toBe(1000);
  });

  it("does not seed when seedData is false/unset even with sourceRef present", async () => {
    const { fetchMock } = stubCloneFetch({
      cloneRef: "clone-ref",
      introspectRows: LIVE_SCHEMA_ROWS(),
      seedSourceRows: [{ id: 1, email: "a@x.com" }],
    });

    await runClone(() =>
      cloneSupabase("token", {
        projectName: "clone-project",
        tables: [{ name: "users", columns: [{ name: "email", type: "text" as const }] }] as any,
        sourceRef: "source-ref",
        // seedData omitted
      }),
    );

    const seedReadCall = fetchMock.mock.calls.find(([url, init]: any) => {
      if (!String(url).includes("/database/query")) return false;
      const body = init?.body ? JSON.parse(init.body) : {};
      return String(body.query ?? "").includes("to_jsonb(t) as row");
    });
    expect(seedReadCall).toBeUndefined();
  });
});
