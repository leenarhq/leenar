// Guard: no UI may call a cloud-only API endpoint without an isCloud gate.
//
// The self-host build talks to a worker that mounts only registerCoreRoutes.
// Anything registerCloudRoutes adds — incidents, usage, autopilot, audit-log,
// notifications, … — answers 404 there. Every 404 found so far was either a
// poller hammering a dead endpoint forever or, worse, a Promise.all that took
// a whole page down with it (console.projects.$id.service-logs.tsx did exactly
// that: one ungated listAllIncidents killed the logs view too).
//
// This test derives the cloud-only API surface from lib/api.ts and asserts
// every consumer of it either references isCloud or is on an explicit,
// justified allowlist. Grep-based on purpose: the alternative is component
// tests, and this app has no component-test infra (all suites are pure logic).
//
// Companion check: an upstream export-time test asserts CLOUD_ONLY below still
// matches the worker's registerCloudRoutes.ts. It lives upstream rather than
// here because the worker source does not exist in the exported core repo,
// where this file DOES run.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC = resolve(import.meta.dirname, "..");

/** Route prefixes served only by Leenar Cloud. Mirrors registerCloudRoutes.ts. */
export const CLOUD_ONLY_MOUNTS = [
  "waitlist",
  "access-request",
  "usage",
  "incidents",
  "audit-log",
  "mcp",
  "agent",
  "slack",
  "whatsapp",
  "channels",
  "notifications",
  "dashboard-chats",
  "jobs",
  "alert-rules",
];

/**
 * Cloud-only routers mounted UNDER a path core also serves, so the prefix
 * alone cannot decide: /api/projects and /api/drifts both exist in core.
 */
export const CLOUD_ONLY_SUBPATHS = {
  projects: [
    "uptime",
    "cost",
    "observability",
    "autopilot-policy",
    "autopilot-actions",
  ],
  drifts: ["reconcile", "reprovision"],
};

const CLOUD_RE = [
  new RegExp(`^/api/(${CLOUD_ONLY_MOUNTS.join("|")})(/|\\?|$)`),
  new RegExp(
    `^/api/projects/X/(${CLOUD_ONLY_SUBPATHS.projects.join("|")})(/|\\?|$)`,
  ),
  new RegExp(
    `^/api/drifts/X/(${CLOUD_ONLY_SUBPATHS.drifts.join("|")})(/|\\?|$)`,
  ),
];

/**
 * Files that call a cloud-only endpoint and do NOT mention isCloud, with the
 * reason each is safe. Every entry is a hole in this guard — keep it short and
 * keep the reasons checkable.
 */
const ALLOWED_UNGATED: Record<string, string> = {
  // Replaced by a "Core stub:" placeholder in the core build (manifest.json
  // webExclude drops the real file; content/routes/ supplies the stub, so the
  // nav Links still resolve).
  "routes/console.settings.notifications.tsx":
    "webExclude — the core build ships a stub instead",
  "routes/console.settings.channels.tsx":
    "webExclude — the core build ships a stub instead",
  // Presentational panels whose ONLY render site sits inside an isCloud block.
  "components/dashboard/AutopilotPanel.tsx":
    "rendered only inside the isCloud block in console.projects.$id.overview.tsx",
  "components/dashboard/DashboardAgent.tsx":
    "rendered only inside the isCloud block in console.projects.$id.overview.tsx",
  "components/dashboard/IncidentsPanel.tsx":
    "rendered only inside the isCloud block in console.projects.$id.logs.tsx",
  "components/dashboard/AlertRulesPanel.tsx":
    "rendered only inside the isCloud block in console.projects.$id.logs.tsx",
  // Gated by an `enabled` prop rather than importing isCloud themselves; the
  // wiring is asserted directly below.
  "components/canvas/hooks/useUsageMonitoring.ts":
    "enabled: isCloud, passed by WorkspaceCanvas",
  "components/canvas/hooks/useIncidentMonitoring.ts":
    "enabled: isCloud, passed by WorkspaceCanvas",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const rel = (p: string) => p.slice(SRC.length + 1);

/** Exported api.ts functions that hit at least one cloud-only path. */
function cloudOnlyApiFunctions(): string[] {
  const api = readFileSync(join(SRC, "lib/api.ts"), "utf8");
  const names: string[] = [];
  for (const chunk of api.split(/\nexport (?:async )?function /).slice(1)) {
    const name = /^([A-Za-z0-9_]+)/.exec(chunk)?.[1];
    if (!name) continue;
    const body = chunk.split(/\nexport /)[0];
    // Two forms: a plain string ("/api/x", `/api/x`) and a template literal
    // whose leading interpolation is the API origin (`${API_URL}/api/x`).
    // Matching only the first form silently skipped every agent helper.
    const paths = [
      ...body.matchAll(/["`](\/api\/[^"`]*)["`]/g),
      ...body.matchAll(/`\$\{[A-Za-z0-9_]+\}(\/api\/[^"`]*)`/g),
    ].map((m) =>
      // `${projectId}` and friends are opaque here — collapse to a placeholder
      // so /api/projects/${id}/cost matches the projects sub-path rule.
      m[1].replace(/\$\{[^}]*\}/g, "X"),
    );
    if (paths.some((p) => CLOUD_RE.some((r) => r.test(p)))) names.push(name);
  }
  return names;
}

const FILES = walk(SRC).filter((f) => rel(f) !== "lib/api.ts");

/** Files calling `fn`, as src-relative paths. */
function consumersOf(fn: string): string[] {
  const re = new RegExp(`\\b${fn}\\b`);
  return FILES.filter((f) => re.test(readFileSync(f, "utf8"))).map(rel);
}

describe("cloud-only API consumers are gated behind isCloud", () => {
  const fns = cloudOnlyApiFunctions();

  it("finds the cloud-only surface at all (guards against a broken parser)", () => {
    // If lib/api.ts is restructured and this drops to zero, the whole suite
    // would pass vacuously. Anchor on functions that must always be here.
    expect(fns).toContain("listOpenIncidents");
    expect(fns).toContain("getWorkflowUsage");
    expect(fns).toContain("getAutopilotPolicy");
    expect(fns.length).toBeGreaterThan(10);
  });

  it("detects paths written as `${API_URL}/api/...` template literals", () => {
    // lib/api.ts writes agent paths as `${API_URL}/api/agent`, not "/api/agent".
    // The original scraper anchored on a quote immediately followed by /api/,
    // so every template-literal caller was invisible to this guard and its
    // consumers were never checked. That is exactly how the canvas chat
    // shipped to the core repo calling a cloud-only endpoint.
    //
    // sendDashboardAgent is the anchor because it is the one that must STAY
    // cloud-only. sendCanvasAgent deliberately left this set when it moved to
    // the core-served /api/canvas-agent — asserting on it here would have to be
    // deleted by that very fix, which is not a regression test.
    expect(fns).toContain("sendDashboardAgent");
  });

  it("has no ungated consumer outside the allowlist", () => {
    const offenders: string[] = [];
    for (const fn of fns) {
      for (const file of consumersOf(fn)) {
        if (file in ALLOWED_UNGATED) continue;
        if (readFileSync(join(SRC, file), "utf8").includes("isCloud")) continue;
        offenders.push(`${file} calls ${fn}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("wires both canvas monitoring hooks with enabled: isCloud", () => {
    // These two poll on a timer, so an ungated one 404s forever rather than
    // once. They take an `enabled` prop instead of importing isCloud, which is
    // why they sit on the allowlist — this is the assertion that earns them
    // their place there.
    const wc = readFileSync(
      join(SRC, "components/canvas/WorkspaceCanvas.tsx"),
      "utf8",
    );
    for (const hook of ["useUsageMonitoring", "useIncidentMonitoring"]) {
      const wired = new RegExp(hook + "\\(\\{[^}]*enabled:\\s*isCloud").test(
        wc,
      );
      expect(wired, hook + " must be called with enabled: isCloud").toBe(true);
    }
  });

  it("has no stale allowlist entry", () => {
    const stale: string[] = [];
    for (const file of Object.keys(ALLOWED_UNGATED)) {
      // This test also runs inside the exported core repo, where a webExclude'd
      // route is either absent or replaced by a "Core stub:" placeholder that
      // calls nothing. Neither means the monorepo entry is stale.
      if (!existsSync(join(SRC, file))) continue;
      const src = readFileSync(join(SRC, file), "utf8");
      if (src.includes("Core stub:")) continue;
      const stillCalls = fns.some((fn) => new RegExp(`\\b${fn}\\b`).test(src));
      if (!stillCalls) stale.push(`${file} no longer calls any cloud-only API`);
      else if (src.includes("isCloud"))
        stale.push(`${file} now gates itself — drop the allowlist entry`);
    }
    expect(stale).toEqual([]);
  });
});
