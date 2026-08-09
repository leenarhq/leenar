import React from "react";
import { Handle, Position } from "@xyflow/react";
import { UserCheck, MoreHorizontal } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function ApprovalNode({ data, selected }: any) {
  return (
    <div
      className={cn(
        "w-[260px] bg-surface-container border border-white/[0.08] rounded-lg overflow-hidden shadow-xl transition-all",
        selected && "ring-1 ring-approval/50 border-approval/20",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-surface-container !border-2 !border-approval/50"
        style={{ left: "-5px" }}
      />

      <div className="bg-approval/8 px-3 py-2 flex items-center justify-between border-b border-approval/15">
        <div className="flex items-center gap-1.5">
          <UserCheck size={13} className="text-approval" />
          <span className="text-[11px] font-bold text-approval uppercase tracking-widest">
            Approval
          </span>
        </div>
        <button className="text-white/25 hover:text-white/70 transition-colors">
          <MoreHorizontal size={13} />
        </button>
      </div>

      <div className="p-3 space-y-1">
        <h3 className="text-[13px] font-semibold text-white/90 truncate">
          {data.label || "Awaiting Approval"}
        </h3>
        {data.description && (
          <p className="text-[12px] text-white/40 line-clamp-2">
            {data.description}
          </p>
        )}
      </div>

      <div className="flex justify-end gap-8 px-3 pb-3">
        <div className="relative flex items-center">
          <span className="text-[11px] text-tertiary/70 font-mono uppercase mr-4">
            Approved
          </span>
          <Handle
            type="source"
            position={Position.Right}
            id="approved"
            className="!w-2.5 !h-2.5 !bg-surface-container !border-2 !border-tertiary/50"
            style={{
              right: "-5px",
              top: "50%",
              transform: "translateY(-50%) translateX(100%)",
            }}
          />
        </div>
        <div className="relative flex items-center">
          <span className="text-[11px] text-error/70 font-mono uppercase mr-4">
            Rejected
          </span>
          <Handle
            type="source"
            position={Position.Right}
            id="rejected"
            className="!w-2.5 !h-2.5 !bg-surface-container !border-2 !border-error/50"
            style={{
              right: "-5px",
              top: "50%",
              transform: "translateY(-50%) translateX(100%)",
            }}
          />
        </div>
      </div>
    </div>
  );
}
