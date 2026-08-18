import type { Incident, StackDrift, NodeUsageData } from "./api";
import type { ProjectSummary } from "./workflows";

export function computeHealthScore(data: {
  incidents: Incident[];
  drifts: StackDrift[];
  health: Array<{ nodeId: string; alive: boolean }>;
  summary: ProjectSummary | null;
  usage: Record<string, NodeUsageData>;
}): number {
  let score = 100;

  // Open 5xx incidents: -20 each, cap -40
  const open5xx = data.incidents.filter(
    (i) => i.status === "open" && i.severity === "5xx",
  );
  score -= Math.min(open5xx.length * 20, 40);

  // Open error/warning incidents: -10 each, cap -20
  const openErrorWarn = data.incidents.filter(
    (i) =>
      i.status === "open" &&
      (i.severity === "error" || i.severity === "warning"),
  );
  score -= Math.min(openErrorWarn.length * 10, 20);

  // resource_missing drifts: -25 each, cap -50
  const missingDrifts = data.drifts.filter(
    (d) => d.drift_type === "resource_missing",
  );
  score -= Math.min(missingDrifts.length * 25, 50);

  // other drifts: -8 each, cap -16
  const otherDrifts = data.drifts.filter(
    (d) => d.drift_type !== "resource_missing",
  );
  score -= Math.min(otherDrifts.length * 8, 16);

  // failed last deploy: -15
  if (data.summary?.last_deploy_status === "failed") {
    score -= 15;
  }

  // dead health nodes: -15 each, cap -30
  const deadNodes = data.health.filter((h) => !h.alive);
  score -= Math.min(deadNodes.length * 15, 30);

  // Supabase db_size >= 80% of 500MB
  const DB_SIZE_THRESHOLD = 500 * 1024 * 1024 * 0.8;
  const MAU_THRESHOLD = 500 * 0.8; // 400

  for (const nodeUsage of Object.values(data.usage)) {
    if (
      nodeUsage.db_size !== undefined &&
      nodeUsage.db_size >= DB_SIZE_THRESHOLD
    ) {
      score -= 5;
    }
    if (nodeUsage.mau !== undefined && nodeUsage.mau >= MAU_THRESHOLD) {
      score -= 5;
    }
  }

  return Math.max(0, score);
}

/**
 * The label and the tone that carries it. The tone is spelled out as a
 * literal union rather than imported from components/console/StateTag so
 * that lib/ keeps no dependency on a component directory; it is
 * structurally assignable to `Tone`. `computeHealthScore` above is
 * untouched — only the presentation half of this module moves.
 */
export function healthLabel(score: number): {
  label: string;
  tone: "ok" | "warn" | "crit";
} {
  if (score >= 80) return { label: "Healthy", tone: "ok" };
  if (score >= 50) return { label: "Warning", tone: "warn" };
  return { label: "Critical", tone: "crit" };
}
