import { DollarSign } from "lucide-react";
import type { CostSummary, Incident } from "../../lib/api";
import { Panel, EmptyRow } from "./Panel";
import { TimeSeriesChart } from "./TimeSeriesChart";

export function CostPanel({
  cost,
}: {
  cost: CostSummary | null;
  incidents: Incident[];
}) {
  const providers = cost ? Object.entries(cost.byProvider) : [];
  return (
    <Panel
      title="Cloud Cost"
      icon={DollarSign}
      action={
        cost ? (
          <span className="text-right font-mono text-sm">
            ${cost.totalThisMonth.toFixed(2)}
            <span className="ml-2 text-[11px] text-muted-foreground">
              proj ${cost.projectedMonthEnd.toFixed(2)}
            </span>
          </span>
        ) : null
      }
    >
      {providers.length === 0 ? (
        <EmptyRow>No cost data yet</EmptyRow>
      ) : (
        <ul className="space-y-3">
          {providers.map(([provider, p]) => (
            <li key={provider}>
              <div className="flex items-center justify-between">
                <div className="font-mono text-xs capitalize">{provider}</div>
                <div className="text-[11px] text-muted-foreground">
                  ${p.thisMonth.toFixed(2)}
                  {p.isEstimate ? " (est.)" : ""}
                </div>
              </div>
              <div className="mt-1 text-foreground/50">
                <TimeSeriesChart
                  height={60}
                  yFormat={(v) => `$${v.toFixed(0)}`}
                  series={[
                    {
                      label: provider,
                      color: "currentColor",
                      points: p.daily.map((d) => ({
                        x: d.date.slice(5),
                        y: d.amount,
                      })),
                    },
                  ]}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
