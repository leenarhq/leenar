import { HeartPulse } from "lucide-react";
import type { StackDrift } from "../../lib/api";
import { Panel, EmptyRow } from "./Panel";
import { Row, Mono } from "../console/Rows";
import { StateDot, StateTag } from "../console/StateTag";

type CanvasLike = {
  nodes?: Array<{ id: string; data?: { label?: string } }>;
} | null;

export function HealthPanel({
  health,
  drifts,
  canvas,
}: {
  health: Array<{ nodeId: string; alive: boolean }>;
  drifts: StackDrift[];
  canvas: CanvasLike;
}) {
  const nodeLabel = (id: string) =>
    canvas?.nodes?.find((n) => n.id === id)?.data?.label ?? id;

  return (
    <Panel
      title="Resource health"
      icon={HeartPulse}
      action={
        drifts.length > 0 ? (
          <StateTag
            tone="warn"
            label={`${drifts.length} drift${drifts.length > 1 ? "s" : ""}`}
          />
        ) : null
      }
      bodyClassName="p-0"
    >
      {health.length === 0 ? (
        <EmptyRow>No resources to monitor</EmptyRow>
      ) : (
        <div>
          {health.map((h) => (
            // No CheckCircle2/XCircle: the dot is the state marker and the
            // word says the rest, so a second glyph is decoration.
            <Row key={h.nodeId}>
              <StateDot tone={h.alive ? "ok" : "crit"} />
              <span className="flex-1 truncate font-mono text-[12px]">
                {nodeLabel(h.nodeId)}
              </span>
              <Mono>{h.alive ? "alive" : "unreachable"}</Mono>
            </Row>
          ))}
        </div>
      )}
    </Panel>
  );
}
