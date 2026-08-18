import React, { useRef, useState, useEffect } from "react";
import {
  Square,
  Maximize2,
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
  LayoutGrid,
  Keyboard,
  PackagePlus,
} from "lucide-react";
import { useReactFlow, useViewport, useNodes, useEdges } from "@xyflow/react";
import { EnvSwitcher } from "./EnvSwitcher";
import { StateDot } from "../console/StateTag";
import { providerIcon } from "./nodes/providerMeta";
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

/** One 30px dock button. */
function DockButton({
  onClick,
  label,
  disabled,
  active,
  children,
}: {
  onClick?: () => void;
  label: string;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`grid h-[30px] w-[30px] place-items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-25 ${
        active
          ? "bg-[var(--hover)] text-foreground"
          : "text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

const ADD_SERVICES = [
  {
    label: "GitHub",
    provider: "github",
    iconName: "Github",
    desc: "Source code & version control",
  },
  {
    label: "Vercel",
    provider: "vercel",
    iconName: "Triangle",
    desc: "Frontend cloud platform",
  },
  {
    label: "Supabase",
    provider: "supabase",
    iconName: "Database",
    desc: "Database & Auth",
  },
  {
    label: "Resend",
    provider: "resend",
    iconName: "Send",
    desc: "Transactional email",
  },
  {
    label: "Cloudflare",
    provider: "cloudflare",
    iconName: "Cloudflare",
    desc: "Workers & R2 storage",
  },
];

const GLASS =
  "rounded-full border border-border-soft bg-[var(--glass)] shadow-[var(--raise-lg)] backdrop-blur-2xl";

export function Toolbar({
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
  const { fitView } = useReactFlow();
  const { zoom } = useViewport();
  const nodes = useNodes();
  const edges = useEdges();
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

  const serviceCount = nodes.filter((n) => n.type === "service").length;
  const saveLabel =
    saveState === "saving"
      ? "saving…"
      : saveState === "unsaved"
        ? "unsaved"
        : saveState === "saved"
          ? "saved"
          : "";

  return (
    <>
      {/* ── Top-left: the project's identity, off the dock ─────────────── */}
      <div className="pointer-events-none absolute left-6 top-5 z-20 flex items-center gap-2.5">
        <div
          className={`pointer-events-auto flex items-center gap-2.5 px-3.5 py-1.5 text-[13px] ${GLASS}`}
        >
          <input
            type="text"
            value={workflowName}
            onChange={(e) => onRename(e.target.value)}
            aria-label="Project name"
            className="w-36 truncate bg-transparent tracking-[-0.01em] outline-none focus:ring-0"
          />
          {saveLabel && (
            <span className="flex shrink-0 items-center gap-1.5 border-l border-border-soft pl-2.5 font-mono text-[10px] lowercase text-dim">
              <StateDot tone={saveState === "saved" ? "ok" : "warn"} />
              {saveLabel}
            </span>
          )}
        </div>

        {showAdvanced && (
          <div className="pointer-events-auto">
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
                className={`flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] lowercase text-muted-foreground transition-colors hover:text-foreground ${GLASS}`}
              >
                <GitBranch size={11} strokeWidth={1.4} />
                add env
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Bottom dock ────────────────────────────────────────────────── */}
      <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2">
        {/* Why Deploy is unavailable, above the dock: the dock is a
            fixed-height row, and below it the string ran off the viewport. */}
        {!isRunning && deployDisabledReason && (
          <p className="whitespace-nowrap text-[11px] text-dim">
            {deployDisabledReason}
          </p>
        )}
        <div
          role="toolbar"
          aria-label="Canvas actions"
          className={`flex items-center gap-3 py-1.5 pl-4.5 pr-2 ${GLASS}`}
        >
          <span className="shrink-0 whitespace-nowrap font-mono text-[11px] lowercase text-muted-foreground">
            {serviceCount} service{serviceCount === 1 ? "" : "s"} ·{" "}
            {edges.length} link{edges.length === 1 ? "" : "s"} ·{" "}
            {Math.round(zoom * 100)}%
          </span>

          <span className="h-5 w-px shrink-0 bg-border" />

          {showAdvanced && (
            <>
              <DockButton
                onClick={onUndo}
                disabled={!canUndo}
                label="Undo (⌘Z)"
              >
                <Undo2 size={15} strokeWidth={1.4} />
              </DockButton>
              <DockButton
                onClick={onRedo}
                disabled={!canRedo}
                label="Redo (⌘Y)"
              >
                <Redo2 size={15} strokeWidth={1.4} />
              </DockButton>
              <span className="h-5 w-px shrink-0 bg-border" />
            </>
          )}

          {/* Add service */}
          {onAddNode && (
            <div className="relative" ref={addRef}>
              <button
                data-tour="sidebar-btn"
                onClick={() => setAddOpen((v) => !v)}
                aria-label="Add a service"
                title="Add a service"
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] transition-colors ${
                  addOpen
                    ? "bg-[var(--hover)] text-foreground"
                    : "text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground"
                }`}
              >
                <Plus size={15} strokeWidth={1.4} />
                Add
              </button>
              {addOpen && (
                <div className="absolute bottom-[calc(100%+10px)] left-0 z-50 w-56 overflow-hidden rounded-xl border border-border-soft bg-popover p-1.5 shadow-[var(--raise-lg)]">
                  <p className="px-2.5 py-1.5 font-mono text-[10px] lowercase text-dim">
                    services
                  </p>
                  {ADD_SERVICES.map((svc) => (
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
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--hover)]"
                    >
                      <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg border border-border text-foreground">
                        {providerIcon(svc.provider)}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[13px]">
                          {svc.label}
                        </span>
                        <span className="truncate text-[11px] text-muted-foreground">
                          {svc.desc}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <span className="h-5 w-px shrink-0 bg-border" />

          {onAutoLayout && (
            <DockButton onClick={onAutoLayout} label="Auto-arrange nodes">
              <LayoutGrid size={15} strokeWidth={1.4} />
            </DockButton>
          )}
          <DockButton
            onClick={() => fitView({ duration: 700 })}
            label="Fit to screen (⌘⇧F)"
          >
            <Maximize2 size={15} strokeWidth={1.4} />
          </DockButton>
          {onScreenshot && (
            <DockButton onClick={onScreenshot} label="Download canvas as PNG">
              <ImageDown size={15} strokeWidth={1.4} />
            </DockButton>
          )}
          <DockButton onClick={onExport} label="Export canvas as JSON">
            <Download size={15} strokeWidth={1.4} />
          </DockButton>
          <DockButton
            onClick={() => fileInputRef.current?.click()}
            label="Import canvas from file"
          >
            <Upload size={15} strokeWidth={1.4} />
            <input
              type="file"
              ref={fileInputRef}
              onChange={onImport}
              accept=".json"
              className="hidden"
            />
          </DockButton>
          {onImportExisting && (
            <DockButton
              onClick={onImportExisting}
              label="Import existing service"
            >
              <PackagePlus size={15} strokeWidth={1.4} />
            </DockButton>
          )}
          {showAdvanced && (
            <DockButton
              onClick={onToggleTerminal}
              active={isTerminalOpen}
              label="Toggle terminal"
            >
              <TerminalSquare size={15} strokeWidth={1.4} />
            </DockButton>
          )}
          {onShowShortcuts && (
            <DockButton
              onClick={onShowShortcuts}
              label="Keyboard shortcuts (?)"
            >
              <Keyboard size={15} strokeWidth={1.4} />
            </DockButton>
          )}

          <span className="h-5 w-px shrink-0 bg-border" />

          {/* The one bright control. */}
          <button
            data-tour="deploy-btn"
            onClick={onRunToggle}
            disabled={!isRunning && !!deployDisabledReason}
            title={
              !isRunning && deployDisabledReason
                ? deployDisabledReason
                : undefined
            }
            className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50 ${
              isRunning
                ? "border border-crit/30 text-crit hover:bg-crit/10"
                : hasDeployError
                  ? "border border-warn/30 text-warn hover:bg-warn/10"
                  : "bg-primary text-primary-foreground hover:opacity-90"
            }`}
          >
            {isRunning ? (
              <Square size={12} fill="currentColor" />
            ) : hasDeployError ? (
              <RotateCcw size={12} strokeWidth={1.6} />
            ) : (
              <Rocket size={12} strokeWidth={1.6} />
            )}
            {isRunning ? "Stop" : hasDeployError ? "Retry" : "Deploy"}
          </button>
        </div>
      </div>
    </>
  );
}
