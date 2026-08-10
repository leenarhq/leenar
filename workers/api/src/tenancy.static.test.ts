// workers/api/src/tenancy.static.test.ts
/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";

// Files still permitted to call raw sb() / local sb closures. SHRINKS per batch.
// Seed this by running: rg -l "\bsb\(" workers/api/src --glob '!*.test.ts'
// FLOOR — Task 12 reduced this to exactly the tenancy/ownership layer + two
// documented special cases. Every other file now routes through
// scopedQuery/scopedBy*/systemQuery.
const ALLOWLIST = new Set<string>([
  "src/utils.ts", // defines sb()
  "src/tenancy.ts", // the only wrapper layer
  "src/ownership.ts", // Task 2 extraction; assertWorkflowOwner/assertEnvOwner ARE the ownership checks the tenancy helpers call
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

describe("tenancy static enforcement", () => {
  it("no raw sb() call outside utils.ts/tenancy.ts except reviewed allowlist entries", () => {
    // NOTE: this used to shell out to `rg` via execSync, but `rg` is not installed as
    // a real binary on this machine/CI (only available as an interactive-shell function
    // injected by the Claude Code CLI) — `execSync(... || true)` silently swallowed the
    // "command not found" failure and always reported zero offenders, making the gate a
    // no-op. A follow-up swapped that for `node:fs`/`node:path`, which then failed
    // `tsc --noEmit` because workers/api's tsconfig intentionally has no Node types (to
    // keep Workers source from typechecking against node globals like `process`/`Buffer`
    // that don't exist at the Workers runtime). `import.meta.glob` (Vite/Vitest's static
    // analysis, typed via `vite/client`) reads the same file contents with no Node API
    // and no new dependency.
    const offenders = Object.entries(files)
      .filter(([path]) => !path.endsWith(".test.ts"))
      .filter(([, content]) => hasRawSbCall(content))
      .map(([path]) => `src/${path.replace(/^\.\//, "")}`)
      .filter((p) => !ALLOWLIST.has(p));
    expect(offenders, `Raw sb() outside the tenancy layer:\n${offenders.join("\n")}`).toEqual([]);
  });
});
