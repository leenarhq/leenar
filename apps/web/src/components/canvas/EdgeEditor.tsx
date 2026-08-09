import React, { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { X, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { Edge } from "@xyflow/react";

interface EdgeEditorProps {
  edge: Edge;
  sourceLabel: string;
  targetLabel: string;
  defaultEnvVars: string[];
  onChange: (envVars: string[]) => void;
  onClose: () => void;
}

const ENV_KEY_RE = /^[A-Z][A-Z0-9_]*$/;

export function EdgeEditor({
  edge,
  sourceLabel,
  targetLabel,
  defaultEnvVars,
  onChange,
  onClose,
}: EdgeEditorProps) {
  const currentVars = (edge.data as any)?.envVars as string[] | undefined;
  const [vars, setVars] = useState<string[]>(currentVars ?? defaultEnvVars);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const commit = (next: string[]) => {
    setVars(next);
    onChange(next);
  };

  const addVar = () => {
    const key = input.trim().toUpperCase();
    if (!key) return;
    if (!ENV_KEY_RE.test(key)) {
      setError("Only A-Z, 0-9 and _ allowed, must start with a letter.");
      return;
    }
    if (key.length > 128) {
      setError("Max 128 characters.");
      return;
    }
    if (vars.includes(key)) {
      setError("Already in list.");
      return;
    }
    if (vars.length >= 20) {
      setError("Max 20 env vars per edge.");
      return;
    }
    setError(null);
    setInput("");
    commit([...vars, key]);
  };

  const removeVar = (v: string) => {
    commit(vars.filter((x) => x !== v));
  };

  const resetToDefaults = () => {
    setError(null);
    commit(defaultEnvVars);
  };

  const clearAll = () => {
    setError(null);
    commit([]);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.18 }}
      className="absolute top-0 right-0 h-full w-80 bg-surface border-l border-border z-50 flex flex-col shadow-xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex flex-col min-w-0">
          <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
            Edge
          </span>
          <span className="text-sm font-semibold text-foreground truncate">
            {sourceLabel} → {targetLabel}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <X size={16} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
            Environment Variables
          </p>

          {vars.length === 0 && (
            <p className="text-xs text-muted-foreground italic">
              No env vars — add one below or reset to defaults.
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            {vars.map((v) => (
              <div
                key={v}
                className="flex items-center justify-between px-2.5 py-1.5 rounded bg-muted/60 border border-border/60 group"
              >
                <span className="text-xs font-mono text-foreground">{v}</span>
                <button
                  onClick={() => removeVar(v)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-destructive transition-all"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Add input */}
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") addVar();
              }}
              placeholder="MY_ENV_VAR"
              className="flex-1 text-xs font-mono px-2.5 py-1.5 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={addVar}
              className="px-2.5 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors flex items-center gap-1"
            >
              <Plus size={12} /> Add
            </button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border flex flex-col gap-2 shrink-0">
        <p className="text-xs text-muted-foreground">
          These vars will be injected into{" "}
          <span className="font-medium text-foreground">{targetLabel}</span> on
          deploy.
        </p>
        <div className="flex gap-2">
          <button
            onClick={resetToDefaults}
            disabled={defaultEnvVars.length === 0}
            className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RotateCcw size={11} /> Reset to defaults
          </button>
          <button
            onClick={clearAll}
            className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded border border-border text-xs text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
          >
            <Trash2 size={11} /> Clear all
          </button>
        </div>
      </div>
    </motion.div>
  );
}
