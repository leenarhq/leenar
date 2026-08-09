import { HeartPulse, CheckCircle2, XCircle } from "lucide-react";
import type { StackDrift } from "../../lib/api";
import { Panel, EmptyRow } from "./Panel";

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
      title="Resource Health"
      icon={HeartPulse}
      action={
        drifts.length > 0 ? (
          <span className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-[10px] text-yellow-500">
            {drifts.length} drift{drifts.length > 1 ? "s" : ""}
          </span>
        ) : null
      }
    >
      {health.length === 0 ? (
        <EmptyRow>No resources to monitor</EmptyRow>
      ) : (
        <ul className="space-y-2">
          {health.map((h) => (
            <li
              key={h.nodeId}
              className="flex items-center justify-between text-xs"
            >
              <span className="truncate font-mono">{nodeLabel(h.nodeId)}</span>
              {h.alive ? (
                <span className="inline-flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Alive
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-destructive">
                  <XCircle className="h-3.5 w-3.5" /> Unreachable
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
