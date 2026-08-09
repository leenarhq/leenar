import React, { useState } from "react";
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
  const envVars = (data as any)?.envVars as string[] | undefined;
  const hasEnv = !!(envVars && envVars.length > 0);

  // Calm ("Sakin") styling: every edge is a quiet neutral line at rest. Colour
  // and weight surface only on interaction (hover / selected) or while a deploy
  // is actively running. Env details collapse to a small dot until hovered.
  const emphasized = selected || hovered || running;
  const color = running
    ? "var(--app-accent-muted, #60a5fa)"
    : selected
      ? "var(--color-white, #ffffff)"
      : hovered
        ? hasEnv || synced
          ? "#34d399"
          : "var(--app-accent, #3b82f6)"
        : "#64748b"; // neutral idle

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
          strokeOpacity: selected ? 1 : hovered ? 0.9 : running ? 0.9 : 0.4,
          strokeDasharray: running ? "9 6" : undefined,
          animation: running ? "blueprintDash 0.5s linear infinite" : undefined,
        }}
      />

      {/* Env indicator — a small dot at rest, expands to the var list on hover */}
      {(hasEnv || synced) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
              zIndex: hovered ? 1000 : 10,
            }}
            className="nodrag nopan"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            {/* Collapsed dot */}
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background:
                  synced || hovered ? "#34d399" : "rgba(52,211,153,0.5)",
                border: `1px solid ${
                  synced || hovered
                    ? "rgba(52,211,153,0.7)"
                    : "rgba(52,211,153,0.3)"
                }`,
                boxShadow:
                  synced || hovered
                    ? "0 0 8px rgba(52,211,153,0.35)"
                    : undefined,
                transition: "background 0.15s, box-shadow 0.15s",
              }}
            />

            {/* Expanded list on hover */}
            {hovered && (
              <div
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 7px)",
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: "var(--app-card-bg)",
                  border: "1px solid rgba(52,211,153,0.18)",
                  borderRadius: 8,
                  padding: "8px 0",
                  minWidth: 248,
                  boxShadow:
                    "0 12px 40px rgba(0,0,0,0.7), 0 0 24px rgba(52,211,153,0.06)",
                  pointerEvents: "none",
                }}
              >
                <div
                  style={{
                    padding: "0 10px 6px",
                    borderBottom: "1px solid var(--app-border-dim)",
                    marginBottom: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize: 8,
                      fontFamily: "monospace",
                      color: "rgba(52,211,153,0.45)",
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                    }}
                  >
                    {synced ? "Injected on provision" : "Injected on deploy"}
                  </span>
                </div>
                {(envVars ?? []).map((v) => (
                  <div
                    key={v}
                    style={{
                      padding: "3px 10px",
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                    }}
                  >
                    <span
                      style={{
                        width: 4,
                        height: 4,
                        borderRadius: "50%",
                        background: "rgba(52,211,153,0.5)",
                        flexShrink: 0,
                      }}
                    />
                    <code
                      style={{
                        fontSize: 9,
                        fontFamily: "monospace",
                        color: "var(--app-text)",
                        letterSpacing: "0.01em",
                      }}
                    >
                      {v}
                    </code>
                  </div>
                ))}
                {/* Arrow */}
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 0,
                    height: 0,
                    borderLeft: "5px solid transparent",
                    borderRight: "5px solid transparent",
                    borderTop: "5px solid rgba(52,211,153,0.18)",
                  }}
                />
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
