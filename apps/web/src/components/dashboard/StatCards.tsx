import type { ProjectSummary } from "../../lib/workflows";
import type { Incident, StackDrift, NodeUsageData } from "../../lib/api";
import { computeHealthScore, healthLabel } from "../../lib/healthScore";
import { NOUNS, statusLabel } from "../../lib/labels";
import { HairGrid, HairCell } from "../console/HairGrid";
import { StateTag } from "../console/StateTag";

function Cell({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
}) {
  return (
    <HairCell className="p-4">
      <div className="font-mono text-[10px] lowercase tracking-wide text-dim">
        {label}
      </div>
      <div className="mt-2 text-[22px] leading-none tabular-nums">{value}</div>
      {sub && <div className="mt-2 text-[11px]">{sub}</div>}
    </HairCell>
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
    <HairGrid cols={5}>
      <Cell
        label="status"
        value={summary ? statusLabel(summary.status) : "—"}
        sub={
          summary?.last_deploy_status ? (
            <span className="font-mono lowercase text-muted-foreground">
              last: {summary.last_deploy_status}
            </span>
          ) : undefined
        }
      />
      <Cell
        label="deployments"
        value={String(summary?.deploy_count ?? 0)}
        sub={
          summary?.last_deploy_status ? (
            <span className="font-mono lowercase text-muted-foreground">
              {summary.last_deploy_status}
            </span>
          ) : undefined
        }
      />
      <Cell
        label={`${NOUNS.service}s`.toLowerCase()}
        value={String(summary?.node_count ?? 0)}
      />
      <Cell
        label={`${NOUNS.connection}s`.toLowerCase()}
        value={String(summary?.edge_count ?? 0)}
      />
      <Cell
        label="health"
        value={String(score)}
        sub={
          <StateTag
            tone={label.tone}
            label={
              openIncidents > 0
                ? `${label.label} · ${openIncidents} open`
                : label.label
            }
          />
        }
      />
    </HairGrid>
  );
}
