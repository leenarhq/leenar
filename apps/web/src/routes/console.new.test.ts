// Guard: the builder-import canvas asymmetry in approve() stays intact.
//
// console.new.tsx's approve() writes the adopted-repo canvas to two places
// that MUST differ in one specific way:
//
//   - createProject's canvas (lands in projects.canvas) has to be stamped by
//     withAdoptedSupabaseRuntime, because deployWorkflow
//     (workers/api/src/deploy.ts, reachable from the MCP deploy_workflow
//     tool) and driftReprovision read that row directly and never merge
//     project_env_node_state. An unstamped canvas there means
//     isAlreadyProvisioned misses the adopted ref and an agent-triggered
//     deploy provisions a second, empty Supabase project beside the one the
//     imported repo already talks to.
//   - saveEnvCanvas's canvas (lands in project_environments.canvas) must NOT
//     be stamped, because every autosave through the canvas endpoints strips
//     runtime keys anyway — the durable truth for the adopted ref there is
//     the project_env_node_state row importNode() writes, not the JSON.
//     Stamping this copy would just get silently stripped, masking the real
//     invariant instead of testing it.
//
// See the docblock on withAdoptedSupabaseRuntime in console.new.tsx for the
// full story. This can't be a normal unit test: importing the route module
// pulls in TanStack Router / the "@" alias, which apps/web/vitest.config.ts
// doesn't configure, and this app has no component-test infra (see
// lib/cloudOnlyApi.test.ts for the established source-text-guard idiom this
// follows).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(import.meta.dirname, "console.new.tsx"),
  "utf8",
);

/**
 * Return the argument text of the first `callee(...)` call in `src`, matching
 * balanced parens so it survives prettier reformatting (line breaks, trailing
 * commas, wrapped ternaries) without depending on where the call happens to
 * end.
 */
function extractCallArgs(src: string, callee: string): string {
  const openIdx = src.indexOf(`${callee}(`);
  if (openIdx === -1) {
    throw new Error(
      `${callee}( not found in console.new.tsx — has approve() been restructured?`,
    );
  }
  let i = openIdx + callee.length + 1;
  const argStart = i;
  let depth = 1;
  while (depth > 0) {
    if (i >= src.length) {
      throw new Error(`unbalanced parens scanning ${callee}(...) call`);
    }
    if (src[i] === "(") depth++;
    else if (src[i] === ")") depth--;
    i++;
  }
  return src.slice(argStart, i - 1);
}

describe("console.new.tsx approve() canvas asymmetry", () => {
  it("finds the helper this test is anchored on (guards against a broken parser)", () => {
    // If withAdoptedSupabaseRuntime is renamed or removed, both assertions
    // below would pass vacuously (neither call site would mention it).
    expect(SRC).toMatch(/function withAdoptedSupabaseRuntime/);
  });

  it("stamps the createProject canvas with withAdoptedSupabaseRuntime", () => {
    const args = extractCallArgs(SRC, "createProject");
    expect(
      args,
      "createProject's canvas argument in approve() must route through " +
        "withAdoptedSupabaseRuntime. deployWorkflow (workers/api/src/deploy.ts) " +
        "and driftReprovision read projects.canvas directly and never merge " +
        "project_env_node_state — an unstamped canvas here means an " +
        "agent-triggered deploy provisions a second, empty Supabase project " +
        "beside the one the imported repo already uses. See the docblock on " +
        "withAdoptedSupabaseRuntime in this file before touching this.",
    ).toMatch(/withAdoptedSupabaseRuntime/);
  });

  it("does NOT stamp the saveEnvCanvas canvas with withAdoptedSupabaseRuntime", () => {
    const args = extractCallArgs(SRC, "saveEnvCanvas");
    expect(
      args,
      "saveEnvCanvas's canvas argument in approve() must stay unstamped. " +
        "Every autosave through the environment canvas endpoints strips " +
        "runtime keys (RUNTIME_NODE_KEYS in workflowProvision.ts), so the " +
        "durable truth for the adopted Supabase ref there is the " +
        "project_env_node_state row importNode() writes, not the canvas JSON. " +
        "Stamping this copy would be silently stripped and would mask the " +
        "real invariant — don't 'fix' this by folding the two writes together.",
    ).not.toMatch(/withAdoptedSupabaseRuntime/);
  });
});
