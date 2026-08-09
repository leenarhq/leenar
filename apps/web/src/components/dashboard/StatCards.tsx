import type { ProjectSummary } from "../../lib/workflows";
import type { Incident, StackDrift, NodeUsageData } from "../../lib/api";
import { computeHealthScore, healthLabel } from "../../lib/healthScore";
import { NOUNS, statusLabel } from "../../lib/labels";

function Card({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function StatCards({
  summary,
  incidents,
  drifts,
  health,
  usage,
}: {
  summary: ProjectSummary | null;
  incidents: Incident[];
  drifts: StackDrift[];
  health: Array<{ nodeId: string; alive: boolean }>;
  usage: Record<string, NodeUsageData>;
}) {
  const score = computeHealthScore({
    incidents,
    drifts,
    health,
    summary,
    usage,
  });
  const label = healthLabel(score);
  const openIncidents = incidents.filter((i) => i.status === "open").length;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Card
        label="Status"
        value={summary ? statusLabel(summary.status) : "—"}
        sub={
          summary?.last_deploy_status
            ? `last: ${summary.last_deploy_status}`
            : undefined
        }
      />
      <Card
        label="Deployments"
        value={String(summary?.deploy_count ?? 0)}
        sub={summary?.last_deploy_status ?? undefined}
      />
      <Card
        label={`${NOUNS.service}s`}
        value={String(summary?.node_count ?? 0)}
      />
      <Card
        label={`${NOUNS.connection}s`}
        value={String(summary?.edge_count ?? 0)}
      />
      <Card
        label="Health"
        value={String(score)}
        sub={
          <span style={{ color: label.color }}>
            {label.label}
            {openIncidents > 0 ? ` · ${openIncidents} open` : ""}
          </span>
        }
      />
    </div>
  );
}
