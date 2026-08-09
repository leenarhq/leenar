import React from "react";
import { Handle, Position, NodeResizer, NodeProps } from "@xyflow/react";
import { Building2, Lock } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function DepartmentNode({ data, selected }: NodeProps) {
  const d = data as any;
  const IconComp: React.ElementType = d.icon || Building2;
  const isLocked = d.isLocked;

  return (
    <div className="relative w-full h-full group">
      {!isLocked && (
        <NodeResizer
          color="var(--app-accent)"
          isVisible={selected}
          minWidth={320}
          minHeight={240}
          handleStyle={{ width: 8, height: 8, borderRadius: 2 }}
        />
      )}

      <div
        className={cn(
          "absolute inset-0 bg-surface-container/20 border-2 border-dashed rounded-lg transition-all",
          isLocked
            ? "border-white/[0.05] bg-surface-container/10"
            : "border-white/[0.08]",
          selected && !isLocked && "border-primary/50 bg-surface-container/40",
          d.highlighted && "border-primary bg-primary/10",
        )}
      />

      <div
        className={cn(
          "absolute -top-3 left-6 border px-3 py-1 flex items-center gap-2 rounded-sm shadow-md transition-colors",
          isLocked
            ? "bg-surface-container border-white/[0.05] opacity-60"
            : "bg-surface-container-high border-white/[0.10]",
        )}
      >
        {isLocked ? (
          <Lock className="size-3 text-white/25" />
        ) : (
          <IconComp className="size-3 text-white/50" />
        )}
        <span
          className={cn(
            "text-[12px] font-bold uppercase tracking-wider",
            isLocked ? "text-white/25" : "text-white/70",
          )}
        >
          {d.label || d.name}
        </span>
        {isLocked && (
          <span className="text-[11px] bg-white/5 text-white/25 px-1 rounded ml-1 font-mono">
            LOCKED
          </span>
        )}
      </div>

      {/* Connection Handles */}
      <Handle
        type="target"
        position={Position.Left}
        id="target-left"
        className="!w-3 !h-3 !bg-surface-container !border-2 !border-white/20 !-left-1.5"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="source-right"
        className="!w-3 !h-3 !bg-surface-container !border-2 !border-white/20 !-right-1.5"
      />
      <Handle
        type="target"
        position={Position.Top}
        id="target-top"
        className="!w-3 !h-3 !bg-surface-container !border-2 !border-white/20 !-top-1.5"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="source-bottom"
        className="!w-3 !h-3 !bg-surface-container !border-2 !border-white/20 !-bottom-1.5"
      />
    </div>
  );
}
