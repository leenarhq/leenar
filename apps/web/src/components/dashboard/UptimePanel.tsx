import { Gauge } from "lucide-react";
import type { UptimeNodeSummary } from "../../lib/api";
import { Panel, EmptyRow } from "./Panel";
import { TimeSeriesChart } from "./TimeSeriesChart";
import { Row, Mono, Dim } from "../console/Rows";
import { StateDot, toneFor } from "../console/StateTag";

type CanvasLike = {
  nodes?: Array<{ id: string; data?: { label?: string } }>;
} | null;

export function UptimePanel({
  uptime,
  canvas,
}: {
  uptime: Record<string, UptimeNodeSummary>;
  canvas: CanvasLike;
}) {
  const entries = Object.entries(uptime);
  const nodeLabel = (id: string) =>
    canvas?.nodes?.find((n) => n.id === id)?.data?.label ?? id;

  return (
    <Panel title="Uptime" icon={Gauge} bodyClassName="p-0">
      {entries.length === 0 ? (
        <EmptyRow>No uptime checks yet</EmptyRow>
      ) : (
        <div>
          {entries.map(([nodeId, u]) => (
            <div
              key={nodeId}
              className="border-b border-border-soft last:border-b-0"
            >
              <div className="flex items-center gap-3.5 px-4 py-3 text-[13px]">
                <StateDot tone={toneFor(u.status)} />
                <span className="flex-1 truncate font-mono text-[12px]">
                  {nodeLabel(nodeId)}
                </span>
                <Mono>{u.uptime7d.toFixed(1)}%</Mono>
                {u.lastLatencyMs != null && <Dim>{u.lastLatencyMs}ms</Dim>}
              </div>
              {u.sparkline.length >= 2 && (
                // text-dim, not text-foreground/40: one of the three weights
                // rather than a hand-made fourth.
                <div className="px-4 pb-3 text-dim">
                  <TimeSeriesChart
                    height={40}
                    yFormat={(v) => `${Math.round(v)}`}
                    series={[
                      {
                        label: "latency",
                        color: "currentColor",
                        points: u.sparkline.map((v, i) => ({
                          x: String(i),
                          y: v,
                        })),
                      },
                    ]}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
