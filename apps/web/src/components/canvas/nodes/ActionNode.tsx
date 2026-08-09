import React, { useRef, useEffect, useState } from "react";
import ReactDOM from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Handle, Position, useEdges } from "@xyflow/react";
import {
  MoreHorizontal,
  Check,
  ExternalLink,
  Loader2,
  AlertTriangle,
  Settings,
  Trash2,
  Copy,
  Zap,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatBytes, timeAgo } from "../../../lib/utils";
import type { Incident } from "../../../lib/api";
import { resolveIncident } from "../../../lib/api";
import { useAuth } from "../../../context/auth";
import { isCloud } from "../../../lib/cloud";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ── Provider metadata — brand icon + accent color ───────────────────────────
const PROVIDER_META: Record<
  string,
  { label: string; accent: string; dim: string }
> = {
  github: {
    label: "GitHub",
    accent: "var(--provider-github)",
    dim: "rgba(139,148,158,0.08)",
  },
  vercel: {
    label: "Vercel",
    accent: "var(--provider-vercel)",
    dim: "rgba(161,161,170,0.08)",
  },
  supabase: {
    label: "Supabase",
    accent: "#3ecf8e",
    dim: "rgba(62,207,142,0.10)",
  },
  resend: { label: "Resend", accent: "#7c6ef7", dim: "rgba(124,110,247,0.08)" },
  cloudflare: {
    label: "Cloudflare",
    accent: "#f6821f",
    dim: "rgba(246,130,31,0.10)",
  },
};

function ProviderIcon({
  provider,
  iconName,
  size = 14,
}: {
  provider?: string;
  iconName?: string;
  size?: number;
}) {
  const s = size;
  if (provider === "github")
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
      </svg>
    );
  if (provider === "vercel")
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor">
        <path d="M24 22.525H0l12-21.05 12 21.05z" />
      </svg>
    );
  if (provider === "supabase")
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
        <path
          fill="#3ECF8E"
          d="M11.9 1.036c-.015-.986-1.26-1.41-1.874-.637L.764 12.05C.295 12.64.706 13.5 1.456 13.5h8.933l.5 9.467c.014.986 1.259 1.41 1.873.637l9.262-11.653c.469-.59.058-1.45-.693-1.45h-8.933l-.498-9.465z"
        />
      </svg>
    );
  if (provider === "resend")
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor">
        <path d="M14.679 0c4.648 0 7.413 2.765 7.413 6.434s-2.765 6.434-7.413 6.434H12.33L24 24h-8.245l-8.88-8.44c-.636-.588-.93-1.273-.93-1.86 0-.831.587-1.565 1.713-1.883l4.574-1.224c1.737-.465 2.936-1.81 2.936-3.572 0-2.153-1.761-3.4-3.939-3.4H0V0z" />
      </svg>
    );
  if (provider === "cloudflare")
    return (
      <svg width={s} height={s} viewBox="0 0 256 120" fill="none">
        <path
          d="M202.357 51.394L197.046 49.27C172.085 105.434 72.786 71.289 66.811 87.997c-.996 11.286 54.227 2.146 93.706 4.059 12.039.583 18.076 9.671 12.964 24.484l10.069.031c11.615-36.209 48.683-17.73 50.232-29.68-2.545-7.857-42.601 0-31.425-35.497z"
          fill="#fff"
        />
        <path
          d="M176.332 110.348c1.593-5.311 1.062-10.622-1.593-13.809-2.656-3.187-6.374-5.311-11.154-5.842L71.17 89.634c-.531 0-1.062-.531-1.593-.531-.531-.531-.531-1.062 0-1.593.531-1.062 1.062-1.593 2.124-1.593l92.946-1.062c11.154-.531 22.839-9.56 27.087-20.182l5.312-13.809c.531-.531 0-1.062-.531-1.593C191.203 22.182 166.772 2 138.091 2c-26.556 0-49.394 16.996-57.361 40.897-5.311-3.718-11.684-5.843-19.12-5.311-12.747 1.062-22.838 11.684-24.432 24.431-.531 3.187 0 6.374.532 9.56C16.996 72.108 0 89.104 0 110.348c0 2.124 0 3.718.531 5.842.531 1.063 1.593 1.594 2.125 1.594H172.614c1.062 0 2.125-.531 2.125-1.594l1.593-5.842z"
          fill="#F4811F"
        />
        <path
          d="M205.544 50.863h-2.656c-.531 0-1.062.531-1.593 1.062l-3.718 12.747c-1.593 5.311-1.062 10.622 1.594 13.809 2.655 3.187 6.373 5.311 11.153 5.842l19.652 1.063c.531 0 1.062.531 1.593.531.531.531.531 1.062 0 1.593-.531 1.063-1.062 1.594-2.124 1.594l-20.183 1.062c-11.154.531-22.839 9.56-27.087 20.182l-1.063 4.781c-.531.531 0 1.593 1.063 1.593h70.142c1.062 0 1.593-.531 1.593-1.593C256 101.32 256 96.539 256 91.759c0-22.839-22.838-40.896-50.456-40.896z"
          fill="#FAAD3F"
        />
      </svg>
    );
  const Icon = iconName ? (LucideIcons as any)[iconName] : undefined;
  return Icon ? <Icon size={s} /> : <Zap size={s} />;
}

interface MenuPos {
  top: number;
  right: number;
}

export function ActionNode({ id, data, selected }: any) {
  const edges = useEdges();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const isProvisioned = data.status === "provisioned";
  const isProvisioning = data.status === "provisioning";
  const isError = data.status === "error";
  const driftCount = (data.driftCount as number | undefined) ?? 0;
  const incidentCount = (data.incidentCount as number | undefined) ?? 0;
  // Native-branching badge: set only on a branch env's provisioned node.
  // `native` = branched off trunk (git branch / Vercel preview / CF namespace);
  // `isolated` = a separate resource (Supabase clone / no-GitHub-link Vercel).
  const branchMode = data.branchMode as "native" | "isolated" | undefined;

  // Detect provisioning → provisioned transition for burst animation
  const prevStatusRef = useRef<string | undefined>(data.status);
  const [showBurst, setShowBurst] = useState(false);
  useEffect(() => {
    if (
      prevStatusRef.current === "provisioning" &&
      data.status === "provisioned"
    ) {
      setShowBurst(true);
      const t = setTimeout(() => setShowBurst(false), 900);
      return () => clearTimeout(t);
    }
    prevStatusRef.current = data.status;
  }, [data.status]);

  const isWired =
    !isProvisioned &&
    !isProvisioning &&
    !isError &&
    edges.some(
      (e) =>
        (e.source === id || e.target === id) &&
        (e.data as any)?.envVars?.length,
    );

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    setMenuOpen((v) => !v);
  };

  // Close on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      )
        setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // Close on scroll / canvas zoom
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("wheel", close, { passive: true });
    window.addEventListener("keydown", close, { passive: true });
    return () => {
      window.removeEventListener("wheel", close);
      window.removeEventListener("keydown", close);
    };
  }, [menuOpen]);

  const dispatch = (action: "settings" | "delete" | "duplicate") => {
    setMenuOpen(false);
    window.dispatchEvent(
      new CustomEvent("leenar:node-menu", { detail: { nodeId: id, action } }),
    );
  };

  const provider = (data.provider as string | undefined) ?? "";
  const meta = PROVIDER_META[provider] ?? {
    label: provider || "Provider",
    accent: "#8b5cf6",
    dim: "rgba(139,92,246,0.08)",
  };

  const statusConf = isProvisioned
    ? { label: "Provisioned", color: "#34d399", icon: <Check size={9} /> }
    : isProvisioning
      ? {
          label: "Deploying…",
          color: "#60a5fa",
          icon: <Loader2 size={9} className="animate-spin" />,
        }
      : isError
        ? { label: "Error", color: "#f87171", icon: <AlertTriangle size={9} /> }
        : isWired
          ? { label: "Wired", color: "#a78bfa", icon: null }
          : { label: "Draft", color: "var(--muted-foreground)", icon: null };

  const borderStyle = selected
    ? `1px solid ${meta.accent}55`
    : isProvisioned
      ? "1px solid rgba(52,211,153,0.25)"
      : isProvisioning
        ? "1px solid rgba(96,165,250,0.30)"
        : isError
          ? "1px solid rgba(248,113,113,0.30)"
          : "1px solid var(--border)";

  const shadowStyle = selected
    ? `0 0 0 1px ${meta.accent}20, 0 8px 32px var(--app-shadow)`
    : isError
      ? "0 4px 24px rgba(248,113,113,0.10), 0 1px 4px var(--app-shadow)"
      : "0 2px 8px var(--app-shadow), 0 0 0 0.5px var(--border)";

  const handleCls =
    "!w-2.5 !h-2.5 !bg-card !border !border-border hover:!border-foreground/40 transition-all";

  const menu =
    menuOpen &&
    menuPos &&
    ReactDOM.createPortal(
      <div
        ref={menuRef}
        className="fixed z-[99999] w-36 overflow-hidden rounded-md border border-border"
        style={{
          top: menuPos.top,
          right: menuPos.right,
          background: "var(--popover)",
          boxShadow: "0 8px 24px var(--app-shadow)",
        }}
        onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <button
          onClick={() => dispatch("settings")}
          className="flex w-full items-center gap-2 px-3 py-2 text-[12px] text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors"
        >
          <Settings size={11} /> Settings
        </button>
        <button
          onClick={() => dispatch("duplicate")}
          className="flex w-full items-center gap-2 px-3 py-2 text-[12px] text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors"
        >
          <Copy size={11} /> Duplicate
        </button>
        <div className="mx-3 border-t border-border" />
        <button
          onClick={() => dispatch("delete")}
          className="flex w-full items-center gap-2 px-3 py-2 text-[12px] text-red-500/70 hover:bg-red-500/[0.06] hover:text-red-500 transition-colors"
        >
          <Trash2 size={11} /> Delete
        </button>
      </div>,
      document.body,
    );

  return (
    <div className="relative">
      {/* Left accent stripe — outside overflow:hidden so it's not clipped */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] z-10 rounded-l-lg pointer-events-none"
        style={{
          background: `linear-gradient(180deg, ${meta.accent}85 0%, ${meta.accent}25 100%)`,
        }}
      />

      {/* Pulse glow ring while provisioning */}
      {isProvisioning && (
        <motion.div
          className="absolute inset-0 rounded-lg pointer-events-none"
          animate={{
            boxShadow: [
              "0 0 0 0px rgba(96,165,250,0)",
              "0 0 0 6px rgba(96,165,250,0.2)",
              "0 0 0 0px rgba(96,165,250,0)",
            ],
          }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      {/* Burst ring when provisioning completes */}
      <AnimatePresence>
        {showBurst && (
          <motion.div
            className="absolute inset-0 rounded-lg pointer-events-none"
            initial={{ boxShadow: "0 0 0 0px rgba(52,211,153,0.6)" }}
            animate={{ boxShadow: "0 0 0 18px rgba(52,211,153,0)" }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>

      <div
        className="w-[272px] rounded-lg overflow-hidden"
        style={{
          background: "var(--card)",
          border: borderStyle,
          boxShadow: shadowStyle,
        }}
      >
        <Handle
          type="target"
          position={Position.Left}
          id="target-left"
          className={handleCls}
          style={{ left: "-6px" }}
        />
        <Handle
          type="source"
          position={Position.Left}
          id="source-left"
          className={handleCls}
          style={{ left: "-6px" }}
        />
        <Handle
          type="source"
          position={Position.Right}
          id="source-right"
          className={handleCls}
          style={{ right: "-6px" }}
        />
        <Handle
          type="target"
          position={Position.Right}
          id="target-right"
          className={handleCls}
          style={{ right: "-6px" }}
        />

        {/* Header band */}
        <div
          className="pl-4 pr-3 pt-2.5 pb-2"
          style={{
            background: `linear-gradient(135deg, ${meta.dim} 0%, transparent 100%)`,
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div
                className="flex items-center gap-1 mb-1"
                style={{ color: meta.accent }}
              >
                <ProviderIcon
                  provider={provider}
                  iconName={data.iconName}
                  size={10}
                />
                <span className="text-[9px] font-mono font-semibold uppercase tracking-widest opacity-60">
                  {meta.label}
                </span>
              </div>
              <p className="text-[13.5px] font-semibold text-foreground/90 truncate leading-tight tracking-tight">
                {data.label || "Service"}
              </p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
              {branchMode && (
                <div
                  className="flex items-center rounded-full px-2 py-0.5"
                  title={
                    branchMode === "native"
                      ? "Native branch — branched off the default environment's resource"
                      : "Isolated branch — a separate resource cloned from the default environment"
                  }
                  style={{
                    background:
                      branchMode === "native" ? "#3b82f612" : "#a855f712",
                    border: `1px solid ${branchMode === "native" ? "#3b82f6" : "#a855f7"}28`,
                  }}
                >
                  <span
                    className="text-[9px] font-mono font-semibold uppercase tracking-wider"
                    style={{
                      color: branchMode === "native" ? "#3b82f6" : "#a855f7",
                    }}
                  >
                    {branchMode}
                  </span>
                </div>
              )}
              <div
                className="flex items-center gap-1 rounded-full px-2 py-0.5"
                style={{
                  background: `${statusConf.color}12`,
                  border: `1px solid ${statusConf.color}28`,
                }}
              >
                <span style={{ color: statusConf.color }}>
                  {statusConf.icon}
                </span>
                <span
                  className="text-[9px] font-mono font-semibold uppercase tracking-wider"
                  style={{ color: statusConf.color }}
                >
                  {statusConf.label}
                </span>
              </div>
              <div className="nodrag">
                <button
                  ref={btnRef}
                  onClick={openMenu}
                  className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                >
                  <MoreHorizontal size={13} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="pl-4 pr-3 py-2.5 space-y-2">
          {data.description ? (
            <p className="text-[11px] text-muted-foreground/70 truncate">
              {data.description}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground/40 italic">
              No description
            </p>
          )}

          {(incidentCount > 0 || driftCount > 0) && (
            <div className="flex flex-wrap gap-1">
              {isCloud && incidentCount > 0 && (
                <IncidentBadge
                  count={incidentCount}
                  incidents={(data.incidents as Incident[] | undefined) ?? []}
                />
              )}
              {driftCount > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    window.dispatchEvent(
                      new CustomEvent("leenar:open-drifts", { detail: {} }),
                    );
                  }}
                  className="nodrag flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/8 px-1.5 py-0.5 text-[10px] font-mono text-amber-400 hover:bg-amber-500/15 transition-colors"
                >
                  <AlertTriangle size={8} /> {driftCount} drift
                  {driftCount > 1 ? "s" : ""}
                </button>
              )}
            </div>
          )}

          {/* Cloudflare post-provisioning info */}
          {isProvisioned && data.provider === "cloudflare" && (
            <p className="text-[11px] font-mono text-muted-foreground/55">
              {data.cloudflareService === "r2"
                ? `bucket: ${(data.cfBucketNameProvisioned as string) || "—"}`
                : `worker: ${(data.cfWorkerNameProvisioned as string) || "—"}`}
            </p>
          )}

          {/* Usage metrics — always shown for provisioned Vercel/Supabase nodes */}
          {isProvisioned &&
            (data.provider === "vercel" || data.provider === "supabase") && (
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {data.provider === "vercel" && (
                  <span className="text-[10px] font-mono text-muted-foreground/55">
                    deploy:{" "}
                    {(data.usage as any)?.lastDeploy
                      ? timeAgo((data.usage as any).lastDeploy.createdAt)
                      : "—"}
                  </span>
                )}
                {data.provider === "supabase" && (
                  <>
                    <span className="text-[10px] font-mono text-muted-foreground/55">
                      db:{" "}
                      {(data.usage as any)?.db_size !== undefined
                        ? formatBytes((data.usage as any).db_size)
                        : "0 B"}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground/55">
                      mau:{" "}
                      {(data.usage as any)?.mau !== undefined
                        ? (data.usage as any).mau.toLocaleString()
                        : "0"}
                    </span>
                  </>
                )}
              </div>
            )}

          {isError && data.errorMsg && (
            <p className="rounded-md border border-red-500/15 bg-red-500/5 px-2 py-1.5 text-[11px] font-mono text-red-400/70 line-clamp-2">
              {data.errorMsg}
            </p>
          )}
        </div>

        {/* Footer */}
        {isProvisioned && data.provisionedUrl && (
          <div className="border-t border-border/50 pl-4 pr-3 py-2">
            <a
              href={data.provisionedUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="nodrag flex items-center justify-center gap-1.5 rounded-md border border-border/50 py-1 text-[10px] font-mono text-muted-foreground/60 transition-colors hover:border-border hover:text-muted-foreground"
            >
              <ExternalLink size={9} /> Open
            </a>
          </div>
        )}

        {/* Indeterminate progress bar — shown while provisioning */}
        {isProvisioning && (
          <div className="h-[2px] w-full overflow-hidden bg-blue-500/[0.06]">
            <div
              className="h-full bg-gradient-to-r from-transparent via-blue-400/60 to-transparent"
              style={{
                width: "45%",
                animation: "provisionSweep 1.4s ease-in-out infinite",
              }}
            />
          </div>
        )}
      </div>

      {menu}
    </div>
  );
}

function IncidentBadge({
  count,
  incidents,
}: {
  count: number;
  incidents: Incident[];
}) {
  const [open, setOpen] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [localIncidents, setLocalIncidents] = useState(incidents);
  const { session } = useAuth();
  const ref = useRef<HTMLDivElement>(null);
  const btnRef2 = useRef<HTMLButtonElement>(null);
  const [popupPos, setPopupPos] = useState<{
    top: number;
    left: number;
  } | null>(null);

  React.useEffect(() => {
    setLocalIncidents(incidents);
  }, [incidents]);

  const handleResolve = async (id: string) => {
    if (!session || resolving) return;
    setResolving(id);
    try {
      await resolveIncident(id, session);
      setLocalIncidents((prev) => prev.filter((i) => i.id !== id));
    } finally {
      setResolving(null);
    }
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const openPopup = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!btnRef2.current) return;
    const rect = btnRef2.current.getBoundingClientRect();
    setPopupPos({ top: rect.bottom + 6, left: rect.left });
    setOpen((v) => !v);
  };

  return (
    <div ref={ref} className="relative nodrag">
      <button
        ref={btnRef2}
        onClick={openPopup}
        className="flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/8 px-1.5 py-0.5 text-[10px] font-mono text-red-400 hover:bg-red-500/15 transition-colors"
      >
        <AlertTriangle size={8} /> {count} incident{count > 1 ? "s" : ""}
      </button>

      <AnimatePresence>
        {open &&
          popupPos &&
          ReactDOM.createPortal(
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className="fixed z-[99999] w-64 overflow-hidden rounded-lg border border-red-500/20"
              style={{
                top: popupPos.top,
                left: popupPos.left,
                background: "var(--popover)",
                boxShadow: "0 8px 24px var(--app-shadow)",
              }}
              onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
                <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-red-400">
                  Open Incidents
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    window.dispatchEvent(
                      new CustomEvent("leenar:chat-prefill", {
                        detail: {
                          text: "Show me the current incidents and suggest fixes",
                        },
                      }),
                    );
                    setOpen(false);
                  }}
                  className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                >
                  Ask AI →
                </button>
              </div>
              <div className="max-h-48 divide-y divide-border/30 overflow-y-auto">
                {localIncidents.length === 0 ? (
                  <p className="px-3 py-2 text-[11px] font-mono text-muted-foreground/60">
                    All resolved
                  </p>
                ) : (
                  localIncidents.map((inc) => (
                    <div key={inc.id} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-mono text-red-400/80">
                          {inc.status_code ?? inc.severity}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-muted-foreground/50">
                            ×{inc.count} ·{" "}
                            {timeAgo(new Date(inc.last_seen_at).getTime())}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleResolve(inc.id);
                            }}
                            disabled={resolving === inc.id}
                            className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors disabled:opacity-30"
                          >
                            {resolving === inc.id ? (
                              <Loader2 size={9} className="animate-spin" />
                            ) : (
                              "Resolve"
                            )}
                          </button>
                        </div>
                      </div>
                      {inc.path && (
                        <p className="mt-0.5 truncate text-[10px] font-mono text-muted-foreground/55">
                          {inc.path}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </motion.div>,
            document.body,
          )}
      </AnimatePresence>
    </div>
  );
}
