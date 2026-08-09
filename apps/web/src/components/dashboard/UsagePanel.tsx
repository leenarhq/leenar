import { Activity } from "lucide-react";
import type { NodeUsageData } from "../../lib/api";
import { formatBytes } from "../../lib/utils";
import { Panel, EmptyRow } from "./Panel";

type CanvasLike = {
  nodes?: Array<{ id: string; data?: { label?: string; provider?: string } }>;
} | null;

export function UsagePanel({
  usage,
  canvas,
}: {
  usage: Record<string, NodeUsageData>;
  canvas: CanvasLike;
  deployments: unknown[];
}) {
  const entries = Object.entries(usage);
  const nodeLabel = (id: string) =>
    canvas?.nodes?.find((n) => n.id === id)?.data?.label ?? id;

  return (
    <Panel title="Usage" icon={Activity} bodyClassName="p-0">
      {entries.length === 0 ? (
        <EmptyRow>No usage metrics</EmptyRow>
      ) : (
        <div className="divide-y divide-border">
          {entries.map(([nodeId, u]) => (
            <div
              key={nodeId}
              className="flex items-center justify-between px-4 py-2.5 text-xs"
            >
              <span className="truncate font-mono">{nodeLabel(nodeId)}</span>
              <div className="flex items-center gap-4 text-muted-foreground">
                {u.db_size != null && <span>DB {formatBytes(u.db_size)}</span>}
                {u.mau != null && <span>{u.mau} MAU</span>}
                {u.lastDeploy?.state && (
                  <span className="capitalize">{u.lastDeploy.state}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
