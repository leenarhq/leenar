import { DollarSign } from "lucide-react";
import type { CostSummary } from "../../lib/api";
import { Panel, EmptyRow } from "./Panel";
import { TimeSeriesChart } from "./TimeSeriesChart";
import { Mono } from "../console/Rows";

export function CostPanel({ cost }: { cost: CostSummary | null }) {
  const providers = cost ? Object.entries(cost.byProvider) : [];
  return (
    <Panel
      title="Cloud cost"
      icon={DollarSign}
      bodyClassName="p-0"
      action={
        cost ? (
          <span className="text-right font-mono text-[13px] tabular-nums">
            ${cost.totalThisMonth.toFixed(2)}
            <span className="ml-2 text-[11px] lowercase text-dim">
              proj ${cost.projectedMonthEnd.toFixed(2)}
            </span>
          </span>
        ) : null
      }
    >
      {providers.length === 0 ? (
        <EmptyRow>No cost data yet</EmptyRow>
      ) : (
        <div>
          {providers.map(([provider, p]) => (
            <div
              key={provider}
              className="border-b border-border-soft px-4 py-3 last:border-b-0"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[12px] lowercase">
                  {provider}
                </span>
                <Mono>
                  ${p.thisMonth.toFixed(2)}
                  {p.isEstimate ? " (est.)" : ""}
                </Mono>
              </div>
              {/* text-dim, not text-foreground/50 — one of the three weights. */}
              <div className="mt-1 text-dim">
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
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
