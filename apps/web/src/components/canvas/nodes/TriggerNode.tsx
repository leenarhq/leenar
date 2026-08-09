import React from "react";
import { Handle, Position } from "@xyflow/react";
import { Clock, Globe, MoreHorizontal, Zap } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const H =
  "!w-2.5 !h-2.5 !bg-card !border !border-border hover:!border-foreground/40 transition-all z-50 rounded-full";

export function TriggerNode({ data, selected }: any) {
  const isSchedule =
    data.subType === "schedule" || data.label?.toLowerCase().includes("timer");
  const isWebhook = data.subType === "webhook" || data.config?.url;
  const configText = isSchedule
    ? data.config?.schedule || ""
    : data.config?.url || "";

  const Icon = isSchedule ? Clock : isWebhook ? Globe : Zap;
  const typeLabel = isSchedule ? "Schedule" : isWebhook ? "Webhook" : "Trigger";

  return (
    <div className="relative group">
      <Handle
        type="source"
        position={Position.Top}
        id="trig-s-top"
        className={H}
        style={{ top: "-5px" }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="trig-s-bottom"
        className={H}
        style={{ bottom: "-5px" }}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="trig-s-left"
        className={H}
        style={{ left: "-5px" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="trig-s-right"
        className={H}
        style={{ right: "-5px" }}
      />

      <div
        className={cn(
          "w-[240px] rounded-lg overflow-hidden relative transition-all",
          selected && "ring-1 ring-trigger/40",
        )}
        style={{
          background: "var(--card)",
          border: selected
            ? "1px solid rgba(34,197,94,0.4)"
            : "1px solid var(--border)",
          boxShadow: "0 2px 8px var(--app-shadow), 0 0 0 0.5px var(--border)",
        }}
      >
        <div className="bg-trigger/8 px-3 py-2 flex items-center justify-between border-b border-trigger/15">
          <div className="flex items-center gap-1.5">
            <Icon size={13} className="text-trigger" />
            <span className="text-[11px] font-bold text-trigger uppercase tracking-widest">
              {typeLabel}
            </span>
          </div>
          <button className="text-muted-foreground/50 hover:text-muted-foreground transition-colors">
            <MoreHorizontal size={13} />
          </button>
        </div>

        <div className="p-3 space-y-0.5">
          <h3 className="text-[13px] font-semibold text-foreground/90 truncate">
            {data.label || typeLabel}
          </h3>
          {configText ? (
            <p className="text-[11px] text-muted-foreground/70 font-mono truncate">
              {configText}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground/40 italic">
              No config
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
