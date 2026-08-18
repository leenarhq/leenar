import { Activity } from "lucide-react";
import type { NodeUsageData } from "../../lib/api";
import { formatBytes } from "../../lib/utils";
import { Panel, EmptyRow } from "./Panel";
import { Row, Mono, Dim } from "../console/Rows";

type CanvasLike = {
  nodes?: Array<{ id: string; data?: { label?: string; provider?: string } }>;
} | null;

export function UsagePanel({
  usage,
  canvas,
}: {
  usage: Record<string, NodeUsageData>;
  canvas: CanvasLike;
}) {
  const entries = Object.entries(usage);
  const nodeLabel = (id: string) =>
    canvas?.nodes?.find((n) => n.id === id)?.data?.label ?? id;

  return (
    <Panel title="Usage" icon={Activity} bodyClassName="p-0">
      {entries.length === 0 ? (
        <EmptyRow>No usage metrics</EmptyRow>
      ) : (
        <div>
          {entries.map(([nodeId, u]) => (
            <Row key={nodeId}>
              <span className="flex-1 truncate font-mono text-[12px]">
                {nodeLabel(nodeId)}
              </span>
              {u.db_size != null && <Mono>db {formatBytes(u.db_size)}</Mono>}
              {u.mau != null && <Mono>{u.mau} mau</Mono>}
              {u.lastDeploy?.state && <Dim>{u.lastDeploy.state}</Dim>}
            </Row>
          ))}
        </div>
      )}
    </Panel>
  );
}
