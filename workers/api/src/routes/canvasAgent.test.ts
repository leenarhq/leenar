/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";

// Read the source as text, not via node:fs — workers/api's tsconfig has no Node
// types on purpose, so `import { readFileSync } from "node:fs"` typechecks
// clean in an editor and then fails `tsc --noEmit`. `import.meta.glob` with
// `?raw` is the same read with no Node API; see tenancy.static.test.ts.
const SRC = (
  import.meta.glob("./canvasAgent.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>
)["./canvasAgent.ts"];

describe("canvas agent stays inside the core boundary", () => {
  it("does not import anything the core export removes", () => {
    // manifest.json removeWorkerFiles deletes these from the core tree; an
    // import would make the exported worker fail to build, which the export's
    // verify_worker catches only after a full staging run.
    for (const mod of [
      "rateLimiter.do",
      "aiQuota",
      "channels",
      "channelAgent",
    ]) {
      expect(SRC, `canvasAgent.ts imports ${mod}`).not.toMatch(
        new RegExp(`from "\\.\\./${mod}"`),
      );
    }
  });

  it("goes through the provisioning hooks for rate limit and quota", () => {
    expect(SRC).toMatch(/provisioningHooks\.rateLimit\.check/);
    expect(SRC).toMatch(/provisioningHooks\.quota\.reserve/);
  });

  it("pins the agent scope to canvas", () => {
    // A widened scope here is the one change that would leak cloud tools into
    // the self-host build through an endpoint core mounts.
    expect(SRC).toMatch(/scope:\s*"canvas"/);
  });
});
