import React from "react";
import { Handle, Position } from "@xyflow/react";
import { Bot, MoreHorizontal, Loader2, Check, X as XIcon } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const H =
  "!w-2.5 !h-2.5 !bg-white/10 !border !border-white/20 hover:!bg-white/25 hover:!border-white/40 transition-all z-50 rounded-full";

export function AgentNode({ data, selected }: any) {
  const isRunning = data.status === "running";
  const isCompleted = data.status === "completed" || data.status === "done";
  const isFailed = data.status === "failed" || data.status === "error";

  return (
    <div className="relative group">
      <Handle
        type="target"
        position={Position.Top}
        id="t-top"
        className={H}
        style={{ top: "-5px" }}
      />
      <Handle
        type="source"
        position={Position.Top}
        id="s-top"
        className={H}
        style={{ top: "-5px" }}
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="t-bottom"
        className={H}
        style={{ bottom: "-5px" }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="s-bottom"
        className={H}
        style={{ bottom: "-5px" }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="t-left"
        className={H}
        style={{ left: "-5px" }}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="s-left"
        className={H}
        style={{ left: "-5px" }}
      />
      <Handle
        type="target"
        position={Position.Right}
        id="t-right"
        className={H}
        style={{ right: "-5px" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="s-right"
        className={H}
        style={{ right: "-5px" }}
      />

      <div
        className={cn(
          "w-[240px] bg-surface-container/90 backdrop-blur-sm border border-white/[0.08] rounded-lg shadow-2xl transition-all relative overflow-hidden",
          selected && "ring-1 ring-agent/40 border-agent/20",
          isRunning && "ring-1 ring-agent/30 animate-pulse",
        )}
      >
        <div className="bg-agent/8 px-3 py-2 flex items-center justify-between border-b border-agent/15">
          <div className="flex items-center gap-1.5">
            <Bot size={13} className="text-agent" />
            <span className="text-[11px] font-bold text-agent uppercase tracking-widest">
              Agent
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {isRunning && (
              <Loader2 size={11} className="text-agent animate-spin" />
            )}
            {isCompleted && <Check size={11} className="text-tertiary" />}
            {isFailed && <XIcon size={11} className="text-error" />}
            <button className="text-white/25 hover:text-white/70 transition-colors">
              <MoreHorizontal size={13} />
            </button>
          </div>
        </div>

        <div className="p-3 space-y-0.5">
          <h3 className="text-[13px] font-semibold text-white/90 leading-tight truncate">
            {data.label || "Agent"}
          </h3>
          <p className="text-[12px] text-white/40 line-clamp-1">
            {data.description || ""}
          </p>
        </div>

        <div className="px-3 pb-2.5">
          <div className="h-0.5 bg-white/[0.05] rounded-full overflow-hidden">
            {isRunning && (
              <div className="h-full bg-agent/40 w-3/5 animate-pulse" />
            )}
            {isCompleted && <div className="h-full bg-tertiary/40 w-full" />}
          </div>
        </div>
      </div>
    </div>
  );
}
