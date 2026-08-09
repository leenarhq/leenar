import React, { useRef, useState, useEffect } from "react";
import {
  Square,
  Maximize2,
  Monitor,
  Download,
  Upload,
  TerminalSquare,
  Undo2,
  Redo2,
  Rocket,
  RotateCcw,
  Plus,
  ImageDown,
  GitBranch,
} from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import { EnvSwitcher } from "./EnvSwitcher";
import type { WorkflowEnvironment } from "../../lib/api";

interface ToolbarProps {
  workflowId?: string;
  isRunning: boolean;
  hasDeployError?: boolean;
  onRunToggle: () => void;
  workflowName: string;
  onRename: (name: string) => void;
  onExport: () => void;
  onImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleTerminal: () => void;
  isTerminalOpen: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  saveState?: "saved" | "saving" | "unsaved";
  onShowShortcuts?: () => void;
  onAutoLayout?: () => void;
  onScreenshot?: () => void;
  onAddNode?: (type: string, data?: any) => void;
  environments?: WorkflowEnvironment[];
  currentEnvId?: string | null;
  onEnvSwitch?: (envId: string) => void;
  onEnvManage?: () => void;
  onImportExisting?: () => void;
  /** Gate for advanced controls (env switcher, terminal toggle, undo/redo).
   *  Before a project's first successful deploy, the toolbar should show only
   *  the primary Deploy action plus the project name — this keeps a first-time
   *  user focused on one action. Defaults to false (calm/pre-deploy toolbar). */
  showAdvanced?: boolean;
  /** Short reason shown near Deploy when it isn't deployable yet (e.g. no
   *  services on the canvas). Purely presentational — callers own the gating
   *  condition; this only renders the string if provided. */
  deployDisabledReason?: string | null;
}

export function Toolbar({
  workflowId,
  isRunning,
  hasDeployError,
  onRunToggle,
  workflowName,
  onRename,
  onExport,
  onImport,
  onToggleTerminal,
  isTerminalOpen,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  saveState,
  onShowShortcuts,
  onAutoLayout,
  onScreenshot,
  onAddNode,
  environments,
  currentEnvId,
  onEnvSwitch,
  onEnvManage,
  onImportExisting,
  showAdvanced = false,
  deployDisabledReason,
}: ToolbarProps) {
  const { fitView, getZoom } = useReactFlow();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [addOpen, setAddOpen] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!addOpen) return;
    const handler = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node))
        setAddOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [addOpen]);

  return (
    <div
      className="h-12 border-b border-white/[0.05] flex items-center justify-between px-4 z-10 relative"
      style={{ background: "var(--app-nav-bg)" }}
    >
      <div className="flex items-center gap-3">
        {/* Logo + workflow name */}
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Monitor size={13} className="text-primary/80" />
          </div>
          <div className="flex flex-col -space-y-0.5">
            <input
              type="text"
              value={workflowName}
              onChange={(e) => onRename(e.target.value)}
              className="bg-transparent border-none text-white/90 font-sans font-semibold text-[14px] focus:ring-1 focus:ring-primary/20 focus:bg-white/5 rounded px-1 -ml-1 outline-none w-36 transition-all tracking-tight"
            />
            <span
              className="text-[11px] font-mono uppercase tracking-[0.15em] px-1 transition-colors"
              style={{
                color:
                  saveState === "unsaved"
                    ? "rgba(251,191,36,0.65)"
                    : saveState === "saving"
                      ? "rgba(96,165,250,0.5)"
                      : saveState === "saved"
                        ? "rgba(34,197,94,0.65)"
                        : "var(--app-text-faint)",
              }}
            >
              {saveState === "saving"
                ? "Saving…"
                : saveState === "unsaved"
                  ? "● Unsaved"
                  : saveState === "saved"
                    ? "✓ Saved"
                    : ""}
            </span>
          </div>
        </div>

        {showAdvanced && (
          <>
            <div className="h-5 w-px bg-white/[0.06]" />

            {/* Undo / Redo */}
            <div className="flex items-center gap-0.5">
              <button
                onClick={onUndo}
                disabled={!canUndo}
                title="Undo (Ctrl+Z)"
                className="p-1.5 rounded-md text-white/35 hover:text-white/80 hover:bg-white/5 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
              >
                <Undo2 size={13} />
              </button>
              <button
                onClick={onRedo}
                disabled={!canRedo}
                title="Redo (Ctrl+Y)"
                className="p-1.5 rounded-md text-white/35 hover:text-white/80 hover:bg-white/5 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
              >
                <Redo2 size={13} />
              </button>
            </div>
          </>
        )}

        <div className="h-5 w-px bg-white/[0.06]" />

        {/* Export / Import */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={onExport}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-white/35 hover:text-white/75 hover:bg-white/5 transition-all text-[13px] font-medium tracking-tight"
          >
            <Download size={12} />
            Export
          </button>
          {onScreenshot && (
            <button
              onClick={onScreenshot}
              title="Download canvas as PNG"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-white/35 hover:text-white/75 hover:bg-white/5 transition-all text-[13px] font-medium tracking-tight"
            >
              <ImageDown size={12} />
              PNG
            </button>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-white/35 hover:text-white/75 hover:bg-white/5 transition-all text-[13px] font-medium tracking-tight"
          >
            <Upload size={12} />
            Import File
            <input
              type="file"
              ref={fileInputRef}
              onChange={onImport}
              accept=".json"
              className="hidden"
            />
          </button>
          {onImportExisting && (
            <button
              onClick={onImportExisting}
              title="Import existing services"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] text-white/50 hover:text-white/80 hover:bg-white/[0.06] transition-all border border-transparent hover:border-white/[0.08]"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Import Service
            </button>
          )}
        </div>

        <div className="w-1" />

        {/* Add Node dropdown */}
        {onAddNode && (
          <div className="relative" ref={addRef}>
            <button
              data-tour="sidebar-btn"
              onClick={() => setAddOpen((v) => !v)}
              title="Add a service"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-all border text-[13px] font-medium tracking-tight ${
                addOpen
                  ? "bg-primary/10 border-primary/25 text-primary"
                  : "bg-white/[0.03] border-white/[0.06] text-white/40 hover:text-white/80 hover:bg-white/[0.06]"
              }`}
            >
              <Plus size={13} />
              Add
            </button>
            {addOpen && (
              <div
                className="absolute left-0 top-[calc(100%+8px)] w-56 border border-white/[0.1] rounded-xl shadow-2xl z-50 p-1.5"
                style={{
                  animation: "dropIn 0.12s ease",
                  background: "var(--app-card-bg)",
                }}
              >
                <div className="px-2.5 py-1.5 mb-1">
                  <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-white/30">
                    Services
                  </p>
                </div>
                {[
                  {
                    label: "GitHub",
                    provider: "github",
                    iconName: "Github",
                    color: "#e2e8f0",
                    desc: "Source code & version control",
                  },
                  {
                    label: "Vercel",
                    provider: "vercel",
                    iconName: "Triangle",
                    color: "var(--app-accent)",
                    desc: "Frontend cloud platform",
                  },
                  {
                    label: "Supabase",
                    provider: "supabase",
                    iconName: "Database",
                    color: "#22c55e",
                    desc: "Database & Auth",
                  },
                  {
                    label: "Resend",
                    provider: "resend",
                    iconName: "Send",
                    color: "#a78bfa",
                    desc: "Transactional email",
                  },
                  {
                    label: "Cloudflare",
                    provider: "cloudflare",
                    iconName: "Cloudflare",
                    color: "#f6821f",
                    desc: "Workers & R2 storage",
                  },
                ].map((svc) => (
                  <button
                    key={svc.provider}
                    onClick={() => {
                      onAddNode("service", {
                        label: svc.label,
                        iconName: svc.iconName,
                        provider: svc.provider,
                      });
                      setAddOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-white/[0.06] transition-all group text-left"
                  >
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: `${svc.color}18` }}
                    >
                      <div
                        className="w-2.5 h-2.5 rounded-sm"
                        style={{ background: svc.color, opacity: 0.8 }}
                      />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[13px] font-medium text-white/75 group-hover:text-white/95 transition-colors">
                        {svc.label}
                      </span>
                      <span className="text-[11px] text-white/30 truncate">
                        {svc.desc}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="w-1" />

        {showAdvanced && (
          <>
            {onEnvManage &&
              environments &&
              environments.length > 0 &&
              onEnvSwitch && (
                <EnvSwitcher
                  environments={environments}
                  currentEnvId={currentEnvId ?? null}
                  onSwitch={onEnvSwitch}
                  onManage={onEnvManage}
                />
              )}
            {onEnvManage && (!environments || environments.length === 0) && (
              <button
                onClick={onEnvManage}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-white/[0.06] bg-white/[0.03] text-[10px] font-semibold uppercase tracking-wide text-white/40 hover:text-white/70 hover:bg-white/[0.05] transition-all"
              >
                <GitBranch size={10} />
                Add Env
              </button>
            )}
          </>
        )}

        {/* Deploy / Stop / Retry */}
        <div className="flex flex-col items-start gap-0.5">
          <button
            data-tour="deploy-btn"
            onClick={onRunToggle}
            disabled={!isRunning && !!deployDisabledReason}
            title={
              !isRunning && deployDisabledReason
                ? deployDisabledReason
                : undefined
            }
            className={`flex items-center gap-2 px-4 py-1.5 rounded-md transition-all active:scale-95 border text-[12px] font-bold uppercase tracking-[0.1em] disabled:opacity-40 disabled:cursor-not-allowed ${
              isRunning
                ? "bg-error/10 border-error/25 text-error hover:bg-error/15"
                : hasDeployError
                  ? "bg-amber-500/10 border-amber-500/25 text-amber-400 hover:bg-amber-500/15"
                  : "bg-primary/10 border-primary/25 text-white hover:bg-primary/15"
            }`}
          >
            {isRunning ? (
              <Square size={11} fill="currentColor" className="animate-pulse" />
            ) : hasDeployError ? (
              <RotateCcw size={11} />
            ) : (
              <Rocket size={11} />
            )}
            {isRunning ? "Stop" : hasDeployError ? "Retry" : "Deploy"}
          </button>
          {!isRunning && deployDisabledReason && (
            <span className="text-[10px] text-white/35 pl-0.5 whitespace-nowrap">
              {deployDisabledReason}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Zoom */}
        <div className="flex items-center gap-2 bg-white/[0.03] px-2.5 py-1 rounded-md border border-white/[0.05]">
          <span className="text-[11px] font-mono text-white/25 uppercase tracking-tighter">
            Zoom
          </span>
          <span className="text-[12px] font-mono font-bold text-primary/70 w-8 text-center">
            {Math.round(getZoom() * 100)}%
          </span>
        </div>

        {/* Fit view */}
        <button
          onClick={() => fitView({ duration: 700 })}
          title="Fit to Screen (⌘⇧F)"
          className="p-1.5 rounded-md border border-white/[0.06] bg-white/[0.03] text-white/35 hover:text-white/80 hover:bg-white/[0.06] transition-all"
        >
          <Maximize2 size={13} />
        </button>

        {/* Auto layout */}
        {onAutoLayout && (
          <button
            onClick={onAutoLayout}
            title="Auto-arrange nodes"
            className="flex items-center gap-1 px-2 py-1.5 rounded-md border border-white/[0.06] bg-white/[0.03] text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-all text-[11px] font-semibold uppercase tracking-wide"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="7" height="5" rx="1" />
              <rect x="14" y="3" width="7" height="5" rx="1" />
              <rect x="3" y="16" width="7" height="5" rx="1" />
              <rect x="14" y="16" width="7" height="5" rx="1" />
              <path d="M6.5 8v4M17.5 8v4M6.5 12h11" />
              <path d="M17.5 12v4" />
            </svg>
            Layout
          </button>
        )}

        <div className="h-5 w-px bg-white/[0.06]" />

        {/* Keyboard shortcuts */}
        {onShowShortcuts && (
          <button
            onClick={onShowShortcuts}
            title="Keyboard shortcuts (?)"
            className="p-1.5 rounded-md border border-white/[0.06] bg-white/[0.03] text-white/25 hover:text-white/70 hover:bg-white/[0.06] transition-all text-[12px] font-bold font-mono w-6 h-6 flex items-center justify-center"
          >
            ?
          </button>
        )}

        {/* Terminal toggle */}
        {showAdvanced && (
          <button
            onClick={onToggleTerminal}
            title="Toggle Terminal"
            className={`p-1.5 rounded-md transition-all border ${
              isTerminalOpen
                ? "bg-canvas-secondary/10 border-canvas-secondary/25 text-canvas-secondary"
                : "bg-white/[0.03] border-white/[0.06] text-white/35 hover:text-white/80"
            }`}
          >
            <TerminalSquare size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
