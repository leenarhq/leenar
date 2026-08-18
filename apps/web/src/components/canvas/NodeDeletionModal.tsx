import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, X, Trash2, Cloud } from "lucide-react";
import type { Node } from "@xyflow/react";

interface NodeDeletionModalProps {
  node: Node;
  onConfirm: (keepResource?: boolean) => void;
  onCancel: () => void;
  isDeprovisioning?: boolean;
}

function generateToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((b) => chars[b % chars.length])
    .join("");
}

export function NodeDeletionModal({
  node,
  onConfirm,
  onCancel,
  isDeprovisioning = false,
}: NodeDeletionModalProps) {
  const data = node.data as any;
  const isProvisioned = data.status === "provisioned";
  const isImported = !!data.imported;
  const label = data.label ?? "this node";
  const url = data.provisionedUrl as string | undefined;

  const [step, setStep] = useState<1 | 2 | "keep-confirm">(1);
  const [confirmToken] = useState(generateToken);
  const [inputToken, setInputToken] = useState("");
  const tokenMatch = inputToken === confirmToken;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.15 }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        className="w-[400px] overflow-hidden rounded-2xl border border-border-soft"
        style={{
          background: "var(--popover)",
          boxShadow: "var(--raise-lg)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-soft">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-secondary border border-border flex items-center justify-center">
              {isImported ? (
                <Trash2 size={14} className="text-muted-foreground" />
              ) : isProvisioned ? (
                <Cloud size={14} className="text-crit" />
              ) : (
                <Trash2 size={14} className="text-crit" />
              )}
            </div>
            <span className="text-[12px] font-semibold text-foreground">
              {isImported
                ? "Remove Imported Service"
                : isProvisioned
                  ? "Delete Cloud Resource"
                  : "Remove Node"}
            </span>
          </div>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-[var(--hover)] rounded-md text-dim hover:text-foreground transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {isImported ? (
            /* IMPORTED — simple remove, no cloud deletion */
            <>
              <p className="text-[12px] text-muted-foreground leading-relaxed">
                Remove{" "}
                <span className="text-foreground font-semibold">{label}</span>{" "}
                from this canvas? The cloud resource will{" "}
                <span className="text-foreground font-semibold">not</span> be
                deleted — it was imported from your existing infrastructure.
              </p>
              {url && (
                <p className="text-[11px] font-mono text-dim truncate">
                  {url.replace(/^https?:\/\//, "")}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={onCancel}
                  className="flex-1 py-2 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-[var(--hover)] text-[11px] font-semibold transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => onConfirm(false)}
                  className="flex-1 py-2 rounded-xl bg-secondary border border-border text-foreground hover:bg-secondary text-[11px] font-semibold transition-all"
                >
                  Remove from Canvas
                </button>
              </div>
            </>
          ) : !isProvisioned ? (
            /* DRAFT — simple confirm */
            <>
              <p className="text-[12px] text-muted-foreground leading-relaxed">
                Remove{" "}
                <span className="text-foreground font-semibold">{label}</span>{" "}
                from the canvas? This node has not been provisioned — no cloud
                resources will be affected.
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={onCancel}
                  className="flex-1 py-2 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-[var(--hover)] text-[11px] font-semibold transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => onConfirm(false)}
                  className="flex-1 py-2 rounded-xl bg-crit/15 border border-crit/30 text-crit hover:bg-crit/15 text-[11px] font-semibold transition-all"
                >
                  Remove Node
                </button>
              </div>
            </>
          ) : step === 1 ? (
            /* PROVISIONED — Step 1: warning */
            <>
              <div className="bg-crit/10 border border-crit/20 rounded-xl p-3.5 space-y-2.5">
                <div className="flex items-center gap-2">
                  <AlertTriangle
                    size={13}
                    className="text-crit flex-shrink-0"
                  />
                  <span className="text-[11px] text-crit lowercase">
                    This will delete a live cloud resource
                  </span>
                </div>
                <ul className="space-y-1.5 pl-1">
                  {[
                    `The ${label} project will be permanently deleted from the cloud provider`,
                    ...(url
                      ? [`Resource: ${url.replace(/^https?:\/\//, "")}`]
                      : []),
                    "All data and configuration will be lost",
                    "This action cannot be undone",
                  ].map((item, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-[11px] text-muted-foreground"
                    >
                      <span className="mt-1.5 w-1 h-1 rounded-full bg-crit flex-shrink-0" />
                      <span
                        className={
                          i === 1
                            ? "font-mono text-[10px] text-muted-foreground"
                            : ""
                        }
                      >
                        {item}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={onCancel}
                  className="flex-1 py-2 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-[var(--hover)] text-[11px] font-semibold transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setStep("keep-confirm")}
                  className="flex-1 py-2 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-[var(--hover)] text-[11px] font-semibold transition-all"
                >
                  Keep Resource
                </button>
                <button
                  onClick={() => setStep(2)}
                  className="flex-1 py-2 rounded-xl bg-crit/15 border border-crit/30 text-crit hover:bg-crit/15 text-[11px] font-semibold transition-all"
                >
                  Delete Everything →
                </button>
              </div>
            </>
          ) : step === "keep-confirm" ? (
            /* KEEP RESOURCE — simple confirm, no token, cloud resource untouched */
            <>
              <p className="text-[12px] text-muted-foreground leading-relaxed">
                These resources will keep running outside Leenar — no longer
                tracked for cost or drift, and won't be deleted automatically.
                You'll need to remove them manually from their provider
                dashboard if you want them gone.
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setStep(1)}
                  disabled={isDeprovisioning}
                  className="flex-1 py-2 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-[var(--hover)] text-[11px] font-semibold transition-all"
                >
                  ← Back
                </button>
                <button
                  onClick={() => onConfirm(true)}
                  disabled={isDeprovisioning}
                  className="flex-1 py-2 rounded-xl bg-secondary border border-border text-foreground hover:bg-secondary text-[11px] font-semibold transition-all disabled:opacity-30"
                >
                  Confirm
                </button>
              </div>
            </>
          ) : (
            /* PROVISIONED — Step 2: token */
            <>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Type the confirmation code to permanently delete this resource:
              </p>
              <div
                className="rounded-xl border border-border-soft py-3 text-center"
                style={{ background: "var(--app-surface)" }}
              >
                <code className="text-[22px] font-mono font-bold tracking-[0.35em] text-crit select-none">
                  {confirmToken}
                </code>
              </div>
              <input
                type="text"
                value={inputToken}
                onChange={(e) =>
                  setInputToken(
                    e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, "")
                      .slice(0, 6),
                  )
                }
                placeholder="Type code here"
                autoFocus
                className="w-full bg-transparent border border-border rounded-xl py-2.5 px-3 text-[14px] font-mono font-bold text-center text-foreground tracking-[0.3em] focus:outline-none focus:border-crit/30 focus:ring-1 focus:ring-crit/20 transition-all placeholder:text-dim placeholder:tracking-normal placeholder:font-normal placeholder:text-[12px]"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setStep(1);
                    setInputToken("");
                  }}
                  className="flex-1 py-2 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-[var(--hover)] text-[11px] font-semibold transition-all"
                >
                  ← Back
                </button>
                <button
                  onClick={() => onConfirm(false)}
                  disabled={!tokenMatch || isDeprovisioning}
                  className="flex-1 py-2 rounded-xl bg-crit/15 border border-crit/30 text-crit hover:bg-crit/15 text-[11px] font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {isDeprovisioning ? "Deleting…" : "Delete Forever"}
                </button>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
