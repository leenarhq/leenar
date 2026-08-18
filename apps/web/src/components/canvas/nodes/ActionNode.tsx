import React, { useRef, useEffect, useState } from "react";
import ReactDOM from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Handle, Position, useEdges } from "@xyflow/react";
import {
  MoreHorizontal,
  Loader2,
  AlertTriangle,
  Settings,
  Trash2,
  Copy,
  ExternalLink,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
import { formatBytes, timeAgo } from "../../../lib/utils";
import type { Incident } from "../../../lib/api";
import { resolveIncident } from "../../../lib/api";
import { useAuth } from "../../../context/auth";
import { isCloud } from "../../../lib/cloud";
import { toneFor } from "../../console/StateTag";
import { NodeShell, PORT_CLASS } from "./NodeShell";
import { providerIcon, providerLabel } from "./providerMeta";
import { envBadgeForNode } from "../edgeDisplay";

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

  // What this node's incoming edges inject into it. Always visible, whether or
  // not an edge is hovered — this is the half of "no edge, no env injection"
  // that has to be readable at rest.
  const envBadge = envBadgeForNode(id, edges as any);

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

  // One status vocabulary, shared with the rest of the console. `wired` and
  // `draft` are both idle: neither is a state anyone needs alerting to.
  const statusLabel = isProvisioned
    ? "provisioned"
    : isProvisioning
      ? "deploying"
      : isError
        ? "error"
        : isWired
          ? "wired"
          : "draft";
  const statusTone = toneFor(data.status ?? "");

  // A custom lucide glyph on the node data wins over the provider default —
  // an imported node can carry one.
  const CustomIcon = data.iconName
    ? (LucideIcons as any)[data.iconName]
    : undefined;
  const icon =
    !provider && CustomIcon ? (
      <CustomIcon className="h-[15px] w-[15px]" strokeWidth={1.4} />
    ) : (
      providerIcon(provider)
    );

  const menu =
    menuOpen &&
    menuPos &&
    ReactDOM.createPortal(
      <div
        ref={menuRef}
        className="fixed z-[99999] w-36 overflow-hidden rounded-xl border border-border-soft bg-popover py-1 shadow-[var(--raise-lg)]"
        style={{ top: menuPos.top, right: menuPos.right }}
        onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <button
          onClick={() => dispatch("settings")}
          className="flex w-full items-center gap-2 px-3 py-2 text-[12px] text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
        >
          <Settings size={11} /> Settings
        </button>
        <button
          onClick={() => dispatch("duplicate")}
          className="flex w-full items-center gap-2 px-3 py-2 text-[12px] text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
        >
          <Copy size={11} /> Duplicate
        </button>
        <div className="my-1 border-t border-border-soft" />
        <button
          onClick={() => dispatch("delete")}
          className="flex w-full items-center gap-2 px-3 py-2 text-[12px] text-crit/80 transition-colors hover:bg-crit/10 hover:text-crit"
        >
          <Trash2 size={11} /> Delete
        </button>
      </div>,
      document.body,
    );

  return (
    <div className="relative">
      {/* Burst ring when provisioning completes. Motion, not hue — the ring
          uses the ok tone because completion is exactly what it marks. */}
      <AnimatePresence>
        {showBurst && (
          <motion.div
            className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-ok"
            initial={{ opacity: 0.7, scale: 1 }}
            animate={{ opacity: 0, scale: 1.08 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>

      {/* Handle ids are load-bearing: edgeDisplay's normalizeHandles pins every
          saved edge to source-right / target-left. Only the class changed. */}
      <Handle
        type="target"
        position={Position.Left}
        id="target-left"
        className={PORT_CLASS}
        style={{ left: "-4px" }}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="source-left"
        className={PORT_CLASS}
        style={{ left: "-4px" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="source-right"
        className={PORT_CLASS}
        style={{ right: "-4px" }}
      />
      <Handle
        type="target"
        position={Position.Right}
        id="target-right"
        className={PORT_CLASS}
        style={{ right: "-4px" }}
      />

      <NodeShell
        selected={selected}
        icon={icon}
        label={data.label || "Service"}
        provider={providerLabel(provider).toLowerCase()}
        footTone={statusTone}
        footLabel={statusLabel}
        footMeta={
          envBadge.vars
            ? `${envBadge.vars} env var${envBadge.vars > 1 ? "s" : ""}`
            : undefined
        }
        action={
          <div className="nodrag">
            <button
              ref={btnRef}
              onClick={openMenu}
              aria-label="Node actions"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
        }
      >
        <div className="mt-3 space-y-2">
          {data.description && (
            <p className="truncate text-[11.5px] text-muted-foreground">
              {data.description}
            </p>
          )}

          {branchMode && (
            <span
              title={
                branchMode === "native"
                  ? "Native branch — branched off the default environment's resource"
                  : "Isolated branch — a separate resource cloned from the default environment"
              }
              className="inline-flex rounded-full border border-border-soft px-2 py-0.5 font-mono text-[10px] lowercase text-muted-foreground"
            >
              {branchMode}
            </span>
          )}

          {(incidentCount > 0 || driftCount > 0) && (
            <div className="flex flex-wrap gap-1.5">
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
                  className="nodrag flex items-center gap-1.5 rounded-full border border-warn/30 px-2 py-0.5 font-mono text-[10px] lowercase text-warn transition-colors hover:bg-warn/10"
                >
                  <AlertTriangle size={9} /> {driftCount} drift
                  {driftCount > 1 ? "s" : ""}
                </button>
              )}
            </div>
          )}

          {/* Cloudflare post-provisioning info */}
          {isProvisioned && data.provider === "cloudflare" && (
            <p className="truncate font-mono text-[10.5px] text-dim">
              {data.cloudflareService === "r2"
                ? `bucket: ${(data.cfBucketNameProvisioned as string) || "—"}`
                : `worker: ${(data.cfWorkerNameProvisioned as string) || "—"}`}
            </p>
          )}

          {/* Usage metrics — always shown for provisioned Vercel/Supabase nodes */}
          {isProvisioned &&
            (data.provider === "vercel" || data.provider === "supabase") && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10.5px] text-dim">
                {data.provider === "vercel" && (
                  <span>
                    deploy:{" "}
                    {(data.usage as any)?.lastDeploy
                      ? timeAgo((data.usage as any).lastDeploy.createdAt)
                      : "—"}
                  </span>
                )}
                {data.provider === "supabase" && (
                  <>
                    <span>
                      db:{" "}
                      {(data.usage as any)?.db_size !== undefined
                        ? formatBytes((data.usage as any).db_size)
                        : "0 B"}
                    </span>
                    <span>
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
            // max-h + leading, not line-clamp: `line-clamp-2` resolves to
            // display:flow-root here, so its height never applies and the
            // second line gets cut through the middle of the glyphs. 44px =
            // 12px padding + two 16px lines, exactly.
            <p className="max-h-11 overflow-hidden rounded-lg border border-crit/30 px-2 py-1.5 font-mono text-[10.5px] leading-4 text-crit">
              {data.errorMsg}
            </p>
          )}

          {isProvisioned && data.provisionedUrl && (
            <a
              href={data.provisionedUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="nodrag flex items-center justify-center gap-1.5 rounded-lg border border-border-soft py-1 font-mono text-[10px] lowercase text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            >
              <ExternalLink size={9} /> Open
            </a>
          )}

          {/* Indeterminate progress bar — shown while provisioning */}
          {isProvisioning && (
            <div className="h-px w-full overflow-hidden bg-border">
              <div
                className="h-full bg-warn"
                style={{
                  width: "45%",
                  animation: "provisionSweep 1.4s ease-in-out infinite",
                }}
              />
            </div>
          )}
        </div>
      </NodeShell>

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
    <div ref={ref} className="nodrag relative">
      <button
        ref={btnRef2}
        onClick={openPopup}
        className="flex items-center gap-1.5 rounded-full border border-crit/30 px-2 py-0.5 font-mono text-[10px] lowercase text-crit transition-colors hover:bg-crit/10"
      >
        <AlertTriangle size={9} /> {count} incident{count > 1 ? "s" : ""}
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
              className="fixed z-[99999] w-64 overflow-hidden rounded-xl border border-border-soft bg-popover shadow-[var(--raise-lg)]"
              style={{ top: popupPos.top, left: popupPos.left }}
              onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-border-soft px-3 py-2">
                <span className="font-mono text-[10px] lowercase text-crit">
                  open incidents
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
                  className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  Ask AI →
                </button>
              </div>
              <div className="max-h-48 divide-y divide-border-soft overflow-y-auto">
                {localIncidents.length === 0 ? (
                  <p className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                    All resolved
                  </p>
                ) : (
                  localIncidents.map((inc) => (
                    <div key={inc.id} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-crit">
                          {inc.status_code ?? inc.severity}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-dim">
                            ×{inc.count} ·{" "}
                            {timeAgo(new Date(inc.last_seen_at).getTime())}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleResolve(inc.id);
                            }}
                            disabled={resolving === inc.id}
                            className="text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
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
                        <p className="mt-0.5 truncate font-mono text-[10px] text-dim">
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
