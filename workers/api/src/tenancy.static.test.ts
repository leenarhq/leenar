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
});
