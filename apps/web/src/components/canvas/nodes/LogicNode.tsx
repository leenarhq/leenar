import React from "react";
import { Handle, Position } from "@xyflow/react";
import { MoreHorizontal, GitBranch } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const H =
  "!w-2.5 !h-2.5 !bg-card !border !border-border hover:!border-foreground/40 transition-all z-50 rounded-full";

export function LogicNode({ data, selected }: any) {
  const condition = data.config?.condition || data.condition || "";
  const yesLabel = data.config?.yesLabel || "true";
  const noLabel = data.config?.noLabel || "false";

  return (
    <div className="relative group">
      <Handle
        type="target"
        position={Position.Top}
        id="logic-t-top"
        className={cn(H, "!border-logic/30")}
        style={{ top: "-5px", left: "30%" }}
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="logic-t-bottom"
        className={cn(H, "!border-logic/30")}
        style={{ bottom: "-5px", left: "30%" }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="logic-t-left"
        className={cn(H, "!border-logic/30")}
        style={{ left: "-5px" }}
      />
      <Handle
        type="source"
        position={Position.Top}
        id="yes"
        className={cn(H, "!border-tertiary/30")}
        style={{ top: "-5px", left: "70%" }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="no"
        className={cn(H, "!border-error/30")}
        style={{ bottom: "-5px", left: "70%" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="yes-r"
        className={cn(H, "!border-tertiary/30")}
        style={{ right: "-5px", top: "30%" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="no-r"
        className={cn(H, "!border-error/30")}
        style={{ right: "-5px", top: "70%" }}
      />

      <div
        className={cn(
          "w-[260px] rounded-lg overflow-hidden relative transition-all",
          selected && "ring-1 ring-logic/40",
        )}
        style={{
          background: "var(--card)",
          border: selected
            ? "1px solid rgba(139,92,246,0.4)"
            : "1px solid var(--border)",
          boxShadow: "0 2px 8px var(--app-shadow), 0 0 0 0.5px var(--border)",
        }}
      >
        <div className="bg-logic/8 px-3 py-2 flex items-center justify-between border-b border-logic/15">
          <div className="flex items-center gap-1.5">
            <GitBranch size={13} className="text-logic" />
            <span className="text-[11px] font-bold text-logic uppercase tracking-widest">
              Control
            </span>
          </div>
          <button className="text-muted-foreground/50 hover:text-muted-foreground transition-colors">
            <MoreHorizontal size={13} />
          </button>
        </div>

        <div className="p-3 space-y-1.5">
          <h3 className="text-[13px] font-semibold text-foreground/90 truncate">
            {data.label || "Decision Gate"}
          </h3>
          <div className="flex items-start gap-2">
            <span className="text-[11px] font-mono text-muted-foreground/50 flex-shrink-0">
              if
            </span>
            {condition ? (
              <span className="text-[11px] font-mono text-muted-foreground/70 truncate">
                {condition}
              </span>
            ) : (
              <span className="text-[11px] font-mono text-muted-foreground/35 italic">
                no condition set
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center border-t border-border/50">
          <div className="flex-1 flex items-center gap-1.5 px-3 py-2 border-r border-border/50">
            <div className="w-1.5 h-1.5 rounded-full bg-tertiary/70" />
            <span className="text-[11px] font-mono text-tertiary/70">
              {yesLabel}
            </span>
          </div>
          <div className="flex-1 flex items-center gap-1.5 px-3 py-2">
            <div className="w-1.5 h-1.5 rounded-full bg-error/70" />
            <span className="text-[11px] font-mono text-error/70">
              {noLabel}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
