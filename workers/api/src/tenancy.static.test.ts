// workers/api/src/tenancy.static.test.ts
/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";

// Files still permitted to call raw sb() / local sb closures. This list only
// ever shrinks. Re-derive it with: rg -l "\bsb\(" workers/api/src --glob '!*.test.ts'
// FLOOR — it is down to exactly the tenancy/ownership layer plus two documented
// special cases. Every other file routes through
// scopedQuery/scopedBy*/systemQuery.
const ALLOWLIST = new Set<string>([
  "src/utils.ts", // defines sb()
  "src/tenancy.ts", // the only wrapper layer
  "src/ownership.ts", // extracted from tenancy.ts; assertWorkflowOwner/assertEnvOwner ARE the ownership checks the tenancy helpers call
  "src/routes/logs.ts", // one remaining raw sb() call: stack_services multi-id IN query, safe-by-construction (see inline comment)
]);

// Same match semantics as `rg -e '(^|[^A-Za-z0-9_.])sb\('`: a raw `sb(` call site,
// not `.sb(` (method call) and not an identifier ending in `sb` (e.g. `assertSb(`).
// Applied per-line, mirroring ripgrep's line-oriented matching.
const SB_CALL_RE = /(^|[^A-Za-z0-9_.])sb\(/;

// This file lives at src/tenancy.static.test.ts, so `./**/*.ts` covers all of `src`.
// `eager: true` + `query: '?raw'` gives back the raw file text (not a module import),
// keyed by the glob-relative path, e.g. './routes/mcp.ts'.
const files = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function hasRawSbCall(content: string): boolean {
  return content.split("\n").some((line: string) => SB_CALL_RE.test(line));
}

// The sb() gate above only sees `sb(` call sites — it is blind to code that
// reaches PostgREST directly via `fetch(\`${env.SUPABASE_URL}/rest/v1/…\`)`.
// The 2026-08-21 audit found ~30 such call sites across 15 files. Every one of
// them carried a correct `user_id=eq.` filter, so nothing was exploitable; the
// gap was that nothing would have caught the next one that didn't. This second
// gate closes that blind spot on the same terms as the first.
//
// FLOOR, and this list only ever shrinks: the right long-run home for each entry
// is a tenancy helper (scopedQuery/scopedBy*/systemQuery), at which point it
// comes off this list and is covered by the sb() gate instead.
const REST_ALLOWLIST = new Set<string>([
  "src/utils.ts", // defines sb() — this IS the wrapper
  "src/aiQuota.ts", // local sb-alike over the quota RPCs; service-role by design
  "src/securityCheck.ts", // fleet-wide abuse sweep (cron): security_events / ip_blocks
  "src/cloudCron.ts", // cron cleanup RPCs, no table reads
  "src/webhookDispatch.ts", // user_webhooks read, filtered on the userId passed in
  "src/routes/registerCoreRoutes.ts", // stacks, filtered id + user_id
  "src/routes/stacks.ts", // stacks, filtered id + user_id
  "src/routes/oauth.ts", // used_oauth_states (system) + user_connections upsert
  "src/routes/usage.ts", // projects + user_connections, both user_id-filtered
  "src/routes/webhooks.ts", // user_webhooks, user_id-filtered
  "src/routes/chat.ts", // ai_usage, user_id-filtered
  "src/routes/apiKeys.ts", // api_keys; key_hash lookup is the auth path itself
  "src/routes/connections.ts", // user_connections, user_id-filtered
  "src/routes/drifts.ts", // stack_drifts, user_id-filtered
  "src/routes/driftActions.ts", // stack_drifts, user_id-filtered
]);

// A line that builds a PostgREST URL. Matches the `/rest/v1/` path segment
// rather than `SUPABASE_URL`, so it also catches a call site that stashes the
// base URL in a local first.
const REST_CALL_RE = /\/rest\/v1\//;

function hasRawRestCall(content: string): boolean {
  return content.split("\n").some((line: string) => REST_CALL_RE.test(line));
}

describe("tenancy static enforcement", () => {
  it("no raw sb() call outside utils.ts/tenancy.ts except reviewed allowlist entries", () => {
    // Reads the sources via `import.meta.glob` deliberately — the two obvious
    // alternatives are both traps. Shelling out to `rg` through
    // `execSync(... || true)` is worse than useless: wherever ripgrep is not on
    // PATH, `|| true` swallows the "command not found" and the gate silently
    // reports zero offenders forever. Reading the tree with `node:fs`/`node:path`
    // instead fails `tsc --noEmit`, because workers/api's tsconfig carries no Node
    // types on purpose — that is what keeps Workers source from typechecking
    // against globals like `process`/`Buffer` that don't exist at the Workers
    // runtime. `import.meta.glob` is resolved statically by Vite/Vitest and typed
    // via `vite/client`: same file contents, no Node API, no new dependency.
    const offenders = Object.entries(files)
      .filter(([path]) => !path.endsWith(".test.ts"))
      .filter(([, content]) => hasRawSbCall(content))
      .map(([path]) => `src/${path.replace(/^\.\//, "")}`)
      .filter((p) => !ALLOWLIST.has(p));
    expect(offenders, `Raw sb() outside the tenancy layer:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("no raw /rest/v1/ fetch outside the reviewed allowlist", () => {
    const offenders = Object.entries(files)
      .filter(([path]) => !path.endsWith(".test.ts"))
      .filter(([, content]) => hasRawRestCall(content))
      .map(([path]) => `src/${path.replace(/^\.\//, "")}`)
      .filter((p) => !REST_ALLOWLIST.has(p));
    expect(
      offenders,
      "Raw PostgREST fetch outside the tenancy layer — route it through\n" +
        "scopedQuery/scopedBy*/systemQuery instead, so tenant scoping is a\n" +
        "property of the helper rather than of the filter string you remembered\n" +
        `to type:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("keeps both allowlists honest — no entry that no longer needs one", () => {
    // A stale allowlist is worse than none: it reads as "reviewed and accepted"
    // for a file that has since been migrated, and quietly re-exempts it if the
    // pattern ever comes back.
    const byPath = new Map(
      Object.entries(files).map(([path, content]) => [
        `src/${path.replace(/^\.\//, "")}`,
        content as string,
      ]),
    );
    const stale = [
      ...[...ALLOWLIST].filter((p) => {
        const c = byPath.get(p);
        return c !== undefined && !hasRawSbCall(c);
      }),
      ...[...REST_ALLOWLIST].filter((p) => {
        const c = byPath.get(p);
        return c !== undefined && !hasRawRestCall(c);
      }),
    ];
    expect(
      stale,
      `Allowlisted file no longer needs the exemption — remove it:\n${stale.join("\n")}`,
    ).toEqual([]);
  });
});
