import { Gauge } from "lucide-react";
import type { UptimeNodeSummary } from "../../lib/api";
import { Panel, EmptyRow, StatusDot } from "./Panel";
import { TimeSeriesChart } from "./TimeSeriesChart";

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
    <Panel title="Uptime" icon={Gauge}>
      {entries.length === 0 ? (
        <EmptyRow>No uptime checks yet</EmptyRow>
      ) : (
        <ul className="space-y-2.5">
          {entries.map(([nodeId, u]) => (
            <li key={nodeId} className="text-xs">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 truncate">
                  <StatusDot tone={u.status} />
                  <span className="truncate font-mono">
                    {nodeLabel(nodeId)}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  {u.uptime7d.toFixed(1)}%
                  {u.lastLatencyMs != null && (
                    <span className="ml-2">{u.lastLatencyMs}ms</span>
                  )}
                </span>
              </div>
              {u.sparkline.length >= 2 && (
                <div className="mt-1 text-foreground/40">
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
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
