import React from "react";
import { Bot, Terminal, User, Code2, Lock, X } from "lucide-react";
import { useReactFlow } from "@xyflow/react";

export type NodeStatus = "idle" | "running" | "done" | "error";

export function StatusDot({ status }: { status?: NodeStatus }) {
  if (!status || status === "idle") return null;
  const cls =
    status === "running"
      ? "bg-yellow-400 animate-pulse"
      : status === "done"
        ? "bg-green-400"
        : "bg-red-500";
  return (
    <span
      className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${cls} shadow-sm z-10`}
      title={
        status === "running" ? "Running" : status === "done" ? "Done" : "Error"
      }
    />
  );
}

export function ExpandButton({
  expanded,
  onClick,
  accentColor,
}: {
  expanded: boolean;
  onClick: (e: React.MouseEvent) => void;
  accentColor: string;
}) {
  return (
    <div
      onClick={onClick}
      className="absolute top-[-9px] left-1/2 -translate-x-1/2 w-4.5 h-4.5 rounded-full bg-white border-[1.5px] cursor-pointer z-20 flex items-center justify-center shadow-md"
      style={{ borderColor: accentColor }}
    >
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
        {expanded ? (
          <path
            d="M1 5.5 L4 2.5 L7 5.5"
            stroke={accentColor}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path
            d="M1 2.5 L4 5.5 L7 2.5"
            stroke={accentColor}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </div>
  );
}

export function NodeDetailPanel({
  nodeId,
  label,
  description,
  currentTask,
  status,
  accentColor,
  iconName,
  params,
  onClose,
}: {
  nodeId: string;
  label: string;
  description?: string;
  currentTask?: string;
  status?: NodeStatus;
  accentColor: string;
  iconName?: string;
  params?: Record<string, string | number>;
  onClose: () => void;
}) {
  const { setNodes } = useReactFlow();
  const [activeTab, setActiveTab] = React.useState<"genel" | "params">("genel");
  const statusLabel =
    status === "running"
      ? "Running"
      : status === "done"
        ? "Completed"
        : status === "error"
          ? "Error"
          : "Waiting";
  const statusColor =
    status === "running"
      ? "#F59E0B"
      : status === "done"
        ? "#22C55E"
        : status === "error"
          ? "#EF4444"
          : "#94a3b8";

  const updateParam = (key: string, value: string | number) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                params: { ...((n.data.params as any) ?? {}), [key]: value },
              },
            }
          : n,
      ),
    );
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="absolute top-[calc(100%+8px)] left-1/2 -translate-x-1/2 z-[9999] w-60 bg-surface-container border border-slate-700 rounded-xl shadow-2xl overflow-hidden"
    >
      {/* top arrow */}
      <div className="absolute top-[-7px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[7px] border-l-transparent border-r-[7px] border-r-transparent border-bottom-[7px] border-b-slate-700" />
      <div className="absolute top-[-5px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-bottom-[6px] border-b-surface-container" />

      {/* title */}
      <div
        style={{ background: accentColor }}
        className="px-3 py-2 flex justify-between items-center"
      >
        <span className="text-white text-[13px] font-bold">{label}</span>
        <button
          onClick={onClose}
          className="text-white/80 hover:text-white text-sm leading-none"
        >
          ✕
        </button>
      </div>

      {/* tab bar */}
      <div className="flex border-b border-slate-800">
        {(["genel", "params"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-1.5 text-[12px] font-bold uppercase tracking-wider transition-colors ${
              activeTab === tab
                ? "bg-surface-container text-primary border-b-2 border-primary"
                : "bg-surface-container-low text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {tab === "genel" ? "General" : "Params"}
          </button>
        ))}
      </div>

      <div className="p-3 flex flex-col gap-2 max-h-64 overflow-y-auto">
        {activeTab === "genel" ? (
          <>
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${statusColor === "#F59E0B" ? "animate-pulse" : ""}`}
                style={{ background: statusColor }}
              />
              <span
                className="text-[12px] font-bold uppercase tracking-wider"
                style={{ color: statusColor }}
              >
                {statusLabel}
              </span>
            </div>
            {description && (
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-on-surface-variant uppercase tracking-widest">
                  Description
                </p>
                <p className="text-[12px] text-on-surface leading-relaxed">
                  {description}
                </p>
              </div>
            )}
            {currentTask && status === "running" && (
              <div className="bg-primary/10 border border-primary/30 rounded-lg p-2">
                <p className="text-[11px] font-bold text-primary uppercase tracking-widest">
                  Active Task
                </p>
                <p className="text-[12px] text-primary font-semibold">
                  {currentTask}
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="text-[12px] text-on-surface-variant italic text-center py-4">
            No parameters defined.
          </div>
        )}
      </div>
    </div>
  );
}
