import React from "react";
import { Handle, Position, NodeResizer, NodeProps } from "@xyflow/react";
import { Building2, Lock } from "lucide-react";
import { PORT_CLASS } from "./NodeShell";

/**
 * A group boundary, not a card.
 *
 * Deliberately does NOT use NodeShell: other nodes sit *inside* a department,
 * and a filled panel behind them would bury them. It is a hairline outline
 * with a label tab on the edge. The outline is solid — dashed borders left the
 * app in PR 1 and do not come back here.
 */
export function DepartmentNode({ data, selected }: NodeProps) {
  const d = data as any;
  const IconComp: React.ElementType = d.icon || Building2;
  const isLocked = d.isLocked;

  return (
    <div className="group relative h-full w-full">
      {!isLocked && (
        <NodeResizer
          color="var(--sel)"
          isVisible={selected}
          minWidth={320}
          minHeight={240}
          handleStyle={{ width: 8, height: 8, borderRadius: 2 }}
        />
      )}

      <div
        className={`absolute inset-0 rounded-2xl border bg-foreground/[0.015] transition-colors ${
          selected && !isLocked
            ? "border-[var(--sel)]"
            : d.highlighted
              ? "border-primary"
              : "border-border"
        } ${isLocked ? "opacity-60" : ""}`}
      />

      <div className="absolute -top-2.5 left-3 flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 font-mono text-[10px] lowercase text-muted-foreground">
        {isLocked ? (
          <Lock className="size-3" strokeWidth={1.4} />
        ) : (
          <IconComp className="size-3" strokeWidth={1.4} />
        )}
        <span className="truncate">{d.label || d.name || "group"}</span>
        {isLocked && <span className="text-dim">· locked</span>}
      </div>

      {/* Connection Handles — ids unchanged. */}
      <Handle
        type="target"
        position={Position.Left}
        id="target-left"
        className={PORT_CLASS}
        style={{ left: "-4px" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="source-right"
        className={PORT_CLASS}
        style={{ right: "-4px" }}
      />
      <Handle
        type="target"
        position={Position.Top}
        id="target-top"
        className={PORT_CLASS}
        style={{ top: "-4px" }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="source-bottom"
        className={PORT_CLASS}
        style={{ bottom: "-4px" }}
      />
    </div>
  );
}
