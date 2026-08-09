import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, X, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Session } from "@supabase/supabase-js";
import {
  listDrifts,
  ignoreDrift,
  reconcileDrift,
  reprovisionResource,
  type StackDrift,
} from "../../lib/api";
import { isCloud } from "../../lib/cloud";

interface DriftReviewModalProps {
  workflowId: string;
  session: Session;
  onClose: () => void;
  onNodeDriftCountChange?: (nodeId: string, newCount: number) => void;
}

const DRIFT_LABEL: Record<StackDrift["drift_type"], string> = {
  resource_missing: "Resource deleted",
  env_removed: "Env var removed",
  domain_removed: "Domain removed",
  paused: "Project paused",
};

const DRIFT_COLOR: Record<StackDrift["drift_type"], string> = {
  resource_missing: "text-red-400",
  env_removed: "text-amber-400",
  domain_removed: "text-amber-400",
  paused: "text-amber-400",
};

export function DriftReviewModal({
  workflowId,
  session,
  onClose,
  onNodeDriftCountChange,
}: DriftReviewModalProps) {
  const [drifts, setDrifts] = useState<StackDrift[]>([]);
  const [loading, setLoading] = useState(true);
  const [ignoring, setIgnoring] = useState<Set<string>>(new Set());
  const [reconciling, setReconciling] = useState<Set<string>>(new Set());
  const [reprovisioning, setReprovisioning] = useState<Set<string>>(new Set());
  const [confirmingReprovision, setConfirmingReprovision] = useState<
    string | null
  >(null);

  useEffect(() => {
    listDrifts(workflowId, session)
      .then(setDrifts)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [workflowId, session]);

  const handleIgnore = async (id: string) => {
    setIgnoring((s) => new Set(s).add(id));
    try {
      await ignoreDrift(id, session);
      const resolved = drifts.find((dr) => dr.id === id);
      const remaining = drifts.filter((dr) => dr.id !== id);
      setDrifts(remaining);
      if (resolved) {
        const newCount = remaining.filter(
          (dr) => dr.node_id === resolved.node_id,
        ).length;
        onNodeDriftCountChange?.(resolved.node_id, newCount);
      }
    } catch (e: unknown) {
      toast.error(
        e instanceof Error ? e.message : "Failed to ignore drift. Try again.",
      );
    } finally {
      setIgnoring((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  };

  const handleReconcile = async (id: string) => {
    setReconciling((s) => new Set(s).add(id));
    try {
      await reconcileDrift(id, session);
      const resolved = drifts.find((dr) => dr.id === id);
      const remaining = drifts.filter((dr) => dr.id !== id);
      setDrifts(remaining);
      toast.success("Drift reconciled.");
      if (resolved) {
        const newCount = remaining.filter(
          (dr) => dr.node_id === resolved.node_id,
        ).length;
        onNodeDriftCountChange?.(resolved.node_id, newCount);
      }
    } catch (e: unknown) {
      toast.error(
        e instanceof Error
          ? e.message
          : "Failed to reconcile drift. Try again.",
      );
    } finally {
      setReconciling((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  };

  const STATEFUL_SERVICES = new Set(["supabase", "github"]);

  const runReprovision = async (drift: StackDrift, confirm: boolean) => {
    setConfirmingReprovision(null);
    setReprovisioning((s) => new Set(s).add(drift.id));
    try {
      await reprovisionResource(drift.id, session, confirm, undefined);
      const remaining = drifts.filter((dr) => dr.id !== drift.id);
      setDrifts(remaining);
      toast.success(
        "Re-provision started. Track progress in your deployments.",
      );
      const newCount = remaining.filter(
        (dr) => dr.node_id === drift.node_id,
      ).length;
      onNodeDriftCountChange?.(drift.node_id, newCount);
    } catch (e: unknown) {
      toast.error(
        e instanceof Error ? e.message : "Failed to re-provision. Try again.",
      );
    } finally {
      setReprovisioning((s) => {
        const n = new Set(s);
        n.delete(drift.id);
        return n;
      });
    }
  };

  const handleReprovisionClick = (drift: StackDrift) => {
    if (STATEFUL_SERVICES.has(drift.service)) {
      setConfirmingReprovision(drift.id);
    } else {
      void runReprovision(drift, false);
    }
  };

  const RECONCILE_LABEL: Record<StackDrift["drift_type"], string> = {
    env_removed: "Re-inject",
    paused: "Unpause",
    domain_removed: "Re-add",
    resource_missing: "Mark Removed",
  };

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9998,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onMouseDown={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 6 }}
        transition={{ duration: 0.15 }}
        style={{
          width: 480,
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          background: "#0c0c0c",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16,
          boxShadow: "0 32px 80px rgba(0,0,0,0.8)",
        }}
        onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px 14px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AlertTriangle
              size={14}
              style={{ color: "rgba(251,191,36,0.8)" }}
            />
            <span
              style={{
                fontSize: 13.5,
                fontWeight: 600,
                color: "rgba(255,255,255,0.88)",
                letterSpacing: "-0.015em",
              }}
            >
              Stack Drifts
            </span>
            {!loading && drifts.length > 0 && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "rgba(251,191,36,0.7)",
                  background: "rgba(251,191,36,0.08)",
                  border: "1px solid rgba(251,191,36,0.18)",
                  borderRadius: 999,
                  padding: "1px 7px",
                }}
              >
                {drifts.length}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.25)",
              cursor: "pointer",
              padding: 4,
              lineHeight: 0,
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {loading ? (
            <div
              style={{
                padding: "32px 20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Loader2
                size={18}
                style={{
                  color: "rgba(255,255,255,0.2)",
                  animation: "spin 1s linear infinite",
                }}
              />
            </div>
          ) : drifts.length === 0 ? (
            <div
              style={{
                padding: "32px 20px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
              }}
            >
              <CheckCircle2
                size={22}
                style={{ color: "rgba(52,211,153,0.5)" }}
              />
              <p
                style={{
                  fontSize: 12.5,
                  color: "rgba(255,255,255,0.3)",
                  margin: 0,
                }}
              >
                No open drifts
              </p>
            </div>
          ) : (
            drifts.map((drift) => (
              <div
                key={drift.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  padding: "9px 20px",
                  borderBottom: "1px solid rgba(255,255,255,0.03)",
                  gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginBottom: 3,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color:
                          drift.drift_type === "resource_missing"
                            ? "rgba(248,113,113,0.8)"
                            : "rgba(251,191,36,0.7)",
                      }}
                    >
                      {DRIFT_LABEL[drift.drift_type]}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: "rgba(255,255,255,0.2)",
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.06)",
                        borderRadius: 4,
                        padding: "1px 5px",
                      }}
                    >
                      {drift.service}
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: 12,
                      color: "rgba(255,255,255,0.55)",
                      margin: 0,
                      fontFamily: "monospace",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {drift.field !== "resource" && drift.field !== "status"
                      ? drift.field
                      : drift.resource_id}
                  </p>
                  <p
                    style={{
                      fontSize: 10.5,
                      color: "rgba(255,255,255,0.2)",
                      margin: "2px 0 0",
                    }}
                  >
                    {new Date(drift.detected_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                {isCloud && confirmingReprovision === drift.id ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      flexShrink: 0,
                      maxWidth: 220,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10.5,
                        color: "rgba(248,113,113,0.9)",
                        lineHeight: 1.3,
                      }}
                    >
                      Creates a brand-new empty {drift.service} resource.
                      Existing data will NOT be restored.
                    </span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => void runReprovision(drift, true)}
                        style={{
                          background: "rgba(248,113,113,0.12)",
                          border: "1px solid rgba(248,113,113,0.35)",
                          borderRadius: 7,
                          color: "rgba(248,113,113,0.95)",
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "4px 10px",
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        Re-provision anyway
                      </button>
                      <button
                        onClick={() => setConfirmingReprovision(null)}
                        style={{
                          background: "rgba(255,255,255,0.04)",
                          border: "1px solid rgba(255,255,255,0.07)",
                          borderRadius: 7,
                          color: "rgba(255,255,255,0.4)",
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "4px 10px",
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    {isCloud && drift.drift_type === "resource_missing" && (
                      <button
                        onClick={() => handleReprovisionClick(drift)}
                        disabled={
                          reprovisioning.has(drift.id) ||
                          reconciling.has(drift.id) ||
                          ignoring.has(drift.id)
                        }
                        style={{
                          background:
                            "color-mix(in srgb, var(--app-accent) 12%, transparent)",
                          border:
                            "1px solid color-mix(in srgb, var(--app-accent) 25%, transparent)",
                          borderRadius: 7,
                          color: "rgba(96,165,250,0.9)",
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "4px 10px",
                          cursor: reprovisioning.has(drift.id)
                            ? "default"
                            : "pointer",
                          opacity: reprovisioning.has(drift.id) ? 0.5 : 1,
                          fontFamily: "inherit",
                          transition: "all 0.12s",
                        }}
                      >
                        {reprovisioning.has(drift.id) ? "…" : "Re-provision"}
                      </button>
                    )}
                    {isCloud && (
                      <button
                        onClick={() => handleReconcile(drift.id)}
                        disabled={
                          reconciling.has(drift.id) ||
                          ignoring.has(drift.id) ||
                          reprovisioning.has(drift.id)
                        }
                        style={{
                          background:
                            drift.drift_type === "resource_missing"
                              ? "rgba(255,255,255,0.05)"
                              : "color-mix(in srgb, var(--app-accent) 12%, transparent)",
                          border:
                            drift.drift_type === "resource_missing"
                              ? "1px solid rgba(255,255,255,0.08)"
                              : "1px solid color-mix(in srgb, var(--app-accent) 25%, transparent)",
                          borderRadius: 7,
                          color:
                            drift.drift_type === "resource_missing"
                              ? "rgba(255,255,255,0.4)"
                              : "rgba(96,165,250,0.9)",
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "4px 10px",
                          cursor: reconciling.has(drift.id)
                            ? "default"
                            : "pointer",
                          opacity: reconciling.has(drift.id) ? 0.5 : 1,
                          fontFamily: "inherit",
                          transition: "all 0.12s",
                        }}
                      >
                        {reconciling.has(drift.id)
                          ? "…"
                          : RECONCILE_LABEL[drift.drift_type]}
                      </button>
                    )}
                    <button
                      onClick={() => handleIgnore(drift.id)}
                      disabled={
                        ignoring.has(drift.id) ||
                        reconciling.has(drift.id) ||
                        reprovisioning.has(drift.id)
                      }
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.07)",
                        borderRadius: 7,
                        color: "rgba(255,255,255,0.25)",
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "4px 10px",
                        cursor: ignoring.has(drift.id) ? "default" : "pointer",
                        opacity: ignoring.has(drift.id) ? 0.5 : 1,
                        fontFamily: "inherit",
                        transition: "all 0.12s",
                      }}
                    >
                      {ignoring.has(drift.id) ? "…" : "Ignore"}
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "10px 20px",
            borderTop: "1px solid rgba(255,255,255,0.05)",
            flexShrink: 0,
          }}
        >
          <p
            style={{
              fontSize: 10.5,
              color: "rgba(255,255,255,0.18)",
              margin: 0,
            }}
          >
            Env values aren't compared, only keys. Drifts auto-resolve on the
            next daily check.
          </p>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
