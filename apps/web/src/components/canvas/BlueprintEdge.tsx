import { useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getBezierPath,
} from "@xyflow/react";

export function BlueprintEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
  selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const [hovered, setHovered] = useState(false);

  const running = !!(data as any)?.running;
  const synced = !!(data as any)?.synced;
  const envVars = ((data as any)?.envVars as string[] | undefined) ?? [];
  const hasEnv = envVars.length > 0;

  const emphasized = selected || hovered || running;

  // One line colour, two states. `ok` marks a connection that has actually
  // been provisioned and synced; everything else is structural chrome and
  // takes the hairline. Selection reads through width and opacity, not hue —
  // this replaces a five-branch expression of #60a5fa / #ffffff / #34d399 /
  // #3b82f6 / #64748b.
  const color = synced ? "var(--ok)" : "var(--edge)";

  // What the edge carries, at a glance. An edge carrying nothing renders no
  // chip at all — that absence is the visible form of "no edge, no env
  // injection", and it is why the chip is not just decoration.
  const payloadLabel = !hasEnv
    ? null
    : envVars.length === 1
      ? envVars[0].toLowerCase()
      : `${envVars[0].toLowerCase()} +${envVars.length - 1}`;

  return (
    <>
      {/* Main line — thin & quiet at rest, no glow halo */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth: selected ? 2 : emphasized ? 1.75 : 1.25,
          strokeOpacity: selected ? 1 : hovered ? 0.9 : running ? 0.9 : 0.55,
          strokeDasharray: running ? "9 6" : undefined,
          animation: running ? "blueprintDash 0.5s linear infinite" : undefined,
        }}
      />

      {/* The payload chip. Progressive disclosure is kept exactly as it
          shipped — summary at rest, full list on hover — only now the resting
          state is the summary itself rather than an anonymous green dot. */}
      {payloadLabel && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              zIndex: hovered ? 1000 : 10,
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <div
              className={`rounded-full border px-2.5 py-0.5 font-mono text-[9.5px] lowercase transition-colors ${
                synced
                  ? "border-ok/30 bg-popover text-ok"
                  : "border-border bg-popover text-muted-foreground"
              }`}
            >
              {payloadLabel}
            </div>

            {hovered && (
              <div className="pointer-events-none absolute bottom-[calc(100%+7px)] left-1/2 min-w-[220px] -translate-x-1/2 overflow-hidden rounded-xl border border-border-soft bg-popover py-1.5 shadow-[var(--raise-lg)]">
                <div className="border-b border-border-soft px-3 pb-1.5">
                  <span className="font-mono text-[9.5px] lowercase text-dim">
                    {synced ? "injected on provision" : "injected on deploy"}
                  </span>
                </div>
                {envVars.map((v) => (
                  <div key={v} className="px-3 py-[3px]">
                    <code className="font-mono text-[10px] text-foreground">
                      {v}
                    </code>
                  </div>
                ))}
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}

      <style>{`
        @keyframes blueprintDash {
          from { stroke-dashoffset: 15; }
          to   { stroke-dashoffset: 0;  }
        }
      `}</style>
    </>
  );
}
