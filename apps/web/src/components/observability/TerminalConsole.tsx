import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { TerminalSquare, X, ChevronUp, ChevronDown } from "lucide-react";
import type { LogEntry } from "../../lib/types";
import { StateDot } from "../console/StateTag";

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
      className={`absolute bottom-0 left-0 w-full ${heightClass} z-40 flex flex-col border-t border-border bg-popover/95 backdrop-blur-xl`}
    >
      <div className="flex items-center justify-between border-b border-border-soft bg-card px-4 py-2">
        <div className="flex items-center gap-3">
          <TerminalSquare size={14} className="text-muted-foreground" />
          <span className="font-mono text-[10px] lowercase tracking-wide text-dim">
            execution terminal
          </span>
          <div className="flex items-center gap-1.5 ml-4">
            {/* ok, not primary: --primary resolves to near-white ink since
                PR 1, so "running" and every success line below had been
                rendering in plain ink. Running is a state. */}
            <span className="relative flex h-2 w-2 items-center justify-center">
              {isActive && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-75" />
              )}
              <StateDot tone={isActive ? "ok" : "idle"} />
            </span>
            <span className="font-mono text-[10px] lowercase tracking-wide text-dim">
              {isActive ? "running" : "idle"}
            </span>
          </div>
          {stepCount != null && (
            <div className="ml-3 flex items-center gap-1 rounded-full border border-border-soft px-2 py-0.5">
              <span className="font-mono text-[10px] tabular-nums text-foreground">
                {stepCount.completed}
              </span>
              <span className="font-mono text-[10px] text-dim">/</span>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {stepCount.total}
              </span>
              <span className="ml-0.5 font-mono text-[10px] lowercase text-dim">
                services
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {}}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <span className="px-1 font-mono text-[10px] lowercase">clear</span>
          </button>
          <div className="mx-1 h-3 w-px bg-border" />
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-crit"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 font-mono text-[13px] leading-relaxed">
        {displayLogs.length === 0 ? (
          <div className="flex h-full items-center justify-center italic text-dim">
            Waiting for execution...
          </div>
        ) : (
          displayLogs.map((log, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="mb-1 flex gap-3 rounded px-2 py-0.5"
            >
              <span className="flex-shrink-0 tabular-nums text-dim">
                [{log.time}]
              </span>
              <span className="w-28 flex-shrink-0 truncate text-dim">
                {log.source}
              </span>
              <span
                className={`min-w-0 flex-1 ${
                  log.type === "error"
                    ? "text-crit"
                    : log.type === "warning"
                      ? "text-warn"
                      : log.type === "success"
                        ? "text-ok"
                        : "text-muted-foreground"
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
