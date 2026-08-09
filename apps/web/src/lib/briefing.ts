import type { DashboardData } from "../hooks/useProjectDashboard";

export type BriefingTone = "success" | "error" | "warning" | "neutral";

export interface BriefingItem {
  id: string;
  tone: BriefingTone;
  title: string;
  detail: string;
  anchor?: string;
}

// keep in sync with apps/web/src/components/canvas/hooks/usageAlerts.ts
const SUPABASE_DB_LIMIT = 500 * 1024 * 1024; // 500 MB
const SUPABASE_MAU_LIMIT = 50_000;
const WARN_THRESHOLD = 0.8;

/**
 * Pure, deterministic function — no AI calls, no side effects.
 * Produces a prioritised list of briefing items from dashboard data.
 */
export function buildBriefing(data: DashboardData): BriefingItem[] {
  const items: BriefingItem[] = [];

  // 1. Open incidents (source: IncidentsPanel.tsx:83)
  const openIncidents = data.incidents.filter((i) => i.status === "open");
  if (openIncidents.length > 0) {
    const count = openIncidents.length;
    // Surface the first incident's path as a detail hint
    const first = openIncidents[0];
    const detail = first.path
      ? `${first.service} returning ${first.severity ?? "error"} on ${first.path}`
      : `${first.service} incident detected`;
    items.push({
      id: "briefing:incidents",
      tone: "error",
      title: `${count} open incident${count !== 1 ? "s" : ""}`,
      detail,
      anchor: "incidents",
    });
  }

  // 2. Unhealthy resources (source: HealthPanel.tsx:19)
  const unhealthyResources = data.health.filter((h) => !h.alive);
  if (unhealthyResources.length > 0) {
    const count = unhealthyResources.length;
    items.push({
      id: "briefing:health",
      tone: "error",
      title: `${count} resource${count !== 1 ? "s" : ""} unreachable`,
      detail: `Node${count !== 1 ? "s" : ""} ${unhealthyResources
        .slice(0, 2)
        .map((h) => h.nodeId.slice(0, 8))
        .join(", ")} ${count !== 1 ? "are" : "is"} not responding`,
    });
  }

  // 3. Open drifts (source: HealthPanel.tsx:18)
  if (data.drifts.length > 0) {
    const count = data.drifts.length;
    items.push({
      id: "briefing:drifts",
      tone: "warning",
      title: `${count} configuration drift${count !== 1 ? "s" : ""} detected`,
      detail: `Infrastructure state diverged from last deployment`,
      anchor: "drifts",
    });
  }

  // 4. Usage threshold warnings (source: usageAlerts.ts:3-9)
  const usageNodeIds = Object.keys(data.usage);
  for (const nodeId of usageNodeIds) {
    const u = data.usage[nodeId];
    if (
      u.db_size !== undefined &&
      u.db_size / SUPABASE_DB_LIMIT >= WARN_THRESHOLD
    ) {
      const pct = Math.round((u.db_size / SUPABASE_DB_LIMIT) * 100);
      items.push({
        id: `briefing:usage:db:${nodeId}`,
        tone: "warning",
        title: `Supabase DB at ${pct}% capacity`,
        detail: `Node ${nodeId.slice(0, 8)} is approaching the 500 MB free-tier limit`,
        anchor: "usage",
      });
    }
    if (u.mau !== undefined && u.mau / SUPABASE_MAU_LIMIT >= WARN_THRESHOLD) {
      const pct = Math.round((u.mau / SUPABASE_MAU_LIMIT) * 100);
      items.push({
        id: `briefing:usage:mau:${nodeId}`,
        tone: "warning",
        title: `Supabase MAU at ${pct}% of limit`,
        detail: `Node ${nodeId.slice(0, 8)} has ${u.mau.toLocaleString()} of 50,000 monthly active users`,
        anchor: "usage",
      });
    }
  }

  // 5. Last deployment failed (source: workflows.ts ProjectSummary)
  if (data.summary?.last_deploy_status === "failed") {
    items.push({
      id: "briefing:deploy:failed",
      tone: "error",
      title: "Last deployment failed",
      detail: "Review the deployment logs and fix errors before re-deploying",
      anchor: "deployments",
    });
  }

  // All-clear (source: HealthPanel.tsx:20 allHealthy pattern)
  const hasProblems =
    openIncidents.length > 0 ||
    data.drifts.length > 0 ||
    unhealthyResources.length > 0 ||
    data.summary?.last_deploy_status === "failed";
  if (!hasProblems && items.length === 0) {
    items.push({
      id: "briefing:all-clear",
      tone: "success",
      title: "Everything looks healthy",
      detail: "No open incidents, drifts, or unreachable resources",
    });
  }

  return items;
}
