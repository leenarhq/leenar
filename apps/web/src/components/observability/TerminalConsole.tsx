import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { TerminalSquare, X, ChevronUp, ChevronDown } from "lucide-react";
import type { LogEntry } from "../../lib/types";

interface TerminalConsoleProps {
  onClose: () => void;
  isRunning: boolean;
  externalLogs?: LogEntry[];
  stackId?: string | null;
  stepCount?: { completed: number; total: number } | null;
}

export function TerminalConsole({
  onClose,
  isRunning,
  externalLogs,
  stepCount,
}: TerminalConsoleProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const displayLogs = externalLogs ?? [];
  const isActive = isRunning;

  useEffect(() => {
    if (bottomRef.current)
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
  }, [displayLogs]);

  const heightClass = isExpanded ? "h-64" : "h-40";

  return (
    <motion.div
      initial={{ y: "100%", opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: "100%", opacity: 0 }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
      className={`absolute bottom-0 left-0 w-full ${heightClass} bg-surface-container-highest/95 backdrop-blur-xl border-t border-slate-700/50 flex flex-col z-40 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]`}
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700/50 bg-surface-container-lowest/50">
        <div className="flex items-center gap-3">
          <TerminalSquare size={14} className="text-primary" />
          <span className="text-[13px] font-mono font-bold text-on-surface uppercase tracking-widest">
            Execution Terminal
          </span>
          <div className="flex items-center gap-1.5 ml-4">
            <span className="relative flex h-2 w-2">
              {isActive && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              )}
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${isActive ? "bg-primary" : "bg-slate-500"}`}
              />
            </span>
            <span className="text-[11px] font-mono uppercase tracking-widest text-on-surface-variant/70">
              {isActive ? "Running" : "Idle"}
            </span>
          </div>
          {stepCount != null && (
            <div className="flex items-center gap-1.5 ml-3 px-2 py-0.5 rounded bg-white/5 border border-slate-700/50">
              <span className="text-[11px] font-mono text-primary font-bold">
                {stepCount.completed}
              </span>
              <span className="text-[11px] font-mono text-on-surface-variant/50">
                /
              </span>
              <span className="text-[11px] font-mono text-on-surface-variant/70">
                {stepCount.total}
              </span>
              <span className="text-[11px] font-mono text-on-surface-variant/50 uppercase tracking-wide ml-0.5">
                services
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {}}
            className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-white/5 rounded transition-colors"
          >
            <span className="text-[11px] font-mono uppercase px-1">Clear</span>
          </button>
          <div className="w-px h-3 bg-slate-700 mx-1" />
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 text-on-surface-variant hover:text-on-surface hover:bg-white/5 rounded transition-colors"
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button
            onClick={onClose}
            className="p-1 text-on-surface-variant hover:text-error hover:bg-error/10 rounded transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 font-mono text-[13px] leading-relaxed">
        {displayLogs.length === 0 ? (
          <div className="text-on-surface-variant/40 italic flex h-full items-center justify-center">
            Waiting for execution...
          </div>
        ) : (
          displayLogs.map((log, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex gap-3 mb-1 hover:bg-white/5 px-2 py-0.5 rounded"
            >
              <span className="text-slate-500 flex-shrink-0">[{log.time}]</span>
              <span className="text-tertiary/70 w-28 flex-shrink-0 truncate">
                {log.source}
              </span>
              <span
                className={`flex-1 ${
                  log.type === "error"
                    ? "text-error"
                    : log.type === "warning"
                      ? "text-amber-400"
                      : log.type === "success"
                        ? "text-primary"
                        : "text-on-surface-variant"
                }`}
              >
                {log.msg}
              </span>
            </motion.div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </motion.div>
  );
}
