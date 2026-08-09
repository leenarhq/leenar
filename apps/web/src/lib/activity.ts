import type { StackDrift, Incident, WorkflowEnvironment } from "./api";

export type ActivityKind = "deploy" | "drift" | "incident" | "environment";

export interface ActivityItem {
  id: string; // unique: `${kind}:${sourceId}:${ts}`
  kind: ActivityKind;
  label: string;
  ts: string; // ISO timestamp
  tone: "success" | "error" | "warning" | "neutral";
}

export function buildActivityFeed(d: {
  deployments: Array<{
    id: string;
    status: string;
    queued_at: string;
    finished_at: string | null;
  }>;
  drifts: StackDrift[];
  incidents: Incident[];
  environments: WorkflowEnvironment[];
}): ActivityItem[] {
  const items: ActivityItem[] = [];

  // Deployments: one item each
  for (const dep of d.deployments) {
    if (dep.finished_at) {
      let label: string;
      let tone: ActivityItem["tone"];
      if (dep.status === "success") {
        label = "Deployment succeeded";
        tone = "success";
      } else if (dep.status === "failed") {
        label = "Deployment failed";
        tone = "error";
      } else if (dep.status === "cancelled") {
        tone = "neutral";
        label = "Deployment cancelled";
      } else {
        label = `Deployment ${dep.status}`;
        tone = "neutral";
      }
      items.push({
        id: `deploy:${dep.id}:${dep.finished_at}`,
        kind: "deploy",
        label,
        ts: dep.finished_at,
        tone,
      });
    } else {
      items.push({
        id: `deploy:${dep.id}:${dep.queued_at}`,
        kind: "deploy",
        label: "Deployment queued",
        ts: dep.queued_at,
        tone: "neutral",
      });
    }
  }

  // Drifts: one item each
  for (const drift of d.drifts) {
    items.push({
      id: `drift:${drift.id}:${drift.detected_at}`,
      kind: "drift",
      label: `Drift detected on ${drift.service} (${drift.drift_type})`,
      ts: drift.detected_at,
      tone: "warning",
    });
  }

  // Incidents: up to two items each
  for (const inc of d.incidents) {
    items.push({
      id: `incident:${inc.id}:open`,
      kind: "incident",
      label: `${inc.severity} incident on ${inc.service}`,
      ts: inc.first_seen_at,
      tone: "error",
    });
    if (inc.resolved_at !== null) {
      items.push({
        id: `incident:${inc.id}:resolved`,
        kind: "incident",
        label: `Incident resolved on ${inc.service}`,
        ts: inc.resolved_at,
        tone: "success",
      });
    }
  }

  // Environments: one item each
  for (const env of d.environments) {
    items.push({
      id: `env:${env.id}:${env.created_at}`,
      kind: "environment",
      label: `Environment "${env.name}" created`,
      ts: env.created_at,
      tone: "neutral",
    });
  }

  // Sort descending by ts, return first 10
  items.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  return items.slice(0, 10);
}
