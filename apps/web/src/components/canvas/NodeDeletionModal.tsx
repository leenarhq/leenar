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
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(5,5,5,0.78)", backdropFilter: "blur(5px)" }}
      onClick={onCancel}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.15 }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        className="w-[400px] rounded-2xl border border-white/[0.08] overflow-hidden"
        style={{
          background: "var(--app-card-bg)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-white/[0.06] border border-white/[0.10] flex items-center justify-center">
              {isImported ? (
                <Trash2 size={14} className="text-white/50" />
              ) : isProvisioned ? (
                <Cloud size={14} className="text-red-400" />
              ) : (
                <Trash2 size={14} className="text-red-400" />
              )}
            </div>
            <span className="text-[12px] font-semibold text-white/85">
              {isImported
                ? "Remove Imported Service"
                : isProvisioned
                  ? "Delete Cloud Resource"
                  : "Remove Node"}
            </span>
          </div>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-white/5 rounded-md text-white/30 hover:text-white/70 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {isImported ? (
            /* IMPORTED — simple remove, no cloud deletion */
            <>
              <p className="text-[12px] text-white/55 leading-relaxed">
                Remove{" "}
                <span className="text-white/85 font-semibold">{label}</span>{" "}
                from this canvas? The cloud resource will{" "}
                <span className="text-white/85 font-semibold">not</span> be
                deleted — it was imported from your existing infrastructure.
              </p>
              {url && (
                <p className="text-[11px] font-mono text-white/30 truncate">
                  {url.replace(/^https?:\/\//, "")}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={onCancel}
                  className="flex-1 py-2 rounded-xl border border-white/[0.08] text-white/50 hover:text-white/80 hover:bg-white/5 text-[11px] font-semibold transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => onConfirm(false)}
                  className="flex-1 py-2 rounded-xl bg-white/[0.07] border border-white/[0.10] text-white/70 hover:bg-white/[0.12] text-[11px] font-semibold transition-all"
                >
                  Remove from Canvas
                </button>
              </div>
            </>
          ) : !isProvisioned ? (
            /* DRAFT — simple confirm */
            <>
              <p className="text-[12px] text-white/55 leading-relaxed">
                Remove{" "}
                <span className="text-white/85 font-semibold">{label}</span>{" "}
                from the canvas? This node has not been provisioned — no cloud
                resources will be affected.
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={onCancel}
                  className="flex-1 py-2 rounded-xl border border-white/[0.08] text-white/50 hover:text-white/80 hover:bg-white/5 text-[11px] font-semibold transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => onConfirm(false)}
                  className="flex-1 py-2 rounded-xl bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/22 text-[11px] font-semibold transition-all"
                >
                  Remove Node
                </button>
              </div>
            </>
          ) : step === 1 ? (
            /* PROVISIONED — Step 1: warning */
            <>
              <div className="bg-red-500/8 border border-red-500/15 rounded-xl p-3.5 space-y-2.5">
                <div className="flex items-center gap-2">
                  <AlertTriangle
                    size={13}
                    className="text-red-400 flex-shrink-0"
                  />
                  <span className="text-[11px] font-bold text-red-400 uppercase tracking-wider">
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
                      className="flex items-start gap-2 text-[11px] text-white/50"
                    >
                      <span className="mt-1.5 w-1 h-1 rounded-full bg-red-500/50 flex-shrink-0" />
                      <span
                        className={
                          i === 1 ? "font-mono text-[10px] text-white/40" : ""
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
                  className="flex-1 py-2 rounded-xl border border-white/[0.08] text-white/50 hover:text-white/80 hover:bg-white/5 text-[11px] font-semibold transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setStep("keep-confirm")}
                  className="flex-1 py-2 rounded-xl border border-white/[0.08] text-white/50 hover:text-white/80 hover:bg-white/5 text-[11px] font-semibold transition-all"
                >
                  Keep Resource
                </button>
                <button
                  onClick={() => setStep(2)}
                  className="flex-1 py-2 rounded-xl bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/22 text-[11px] font-semibold transition-all"
                >
                  Delete Everything →
                </button>
              </div>
            </>
          ) : step === "keep-confirm" ? (
            /* KEEP RESOURCE — simple confirm, no token, cloud resource untouched */
            <>
              <p className="text-[12px] text-white/55 leading-relaxed">
                These resources will keep running outside Leenar — no longer
                tracked for cost or drift, and won't be deleted automatically.
                You'll need to remove them manually from their provider
                dashboard if you want them gone.
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setStep(1)}
                  disabled={isDeprovisioning}
                  className="flex-1 py-2 rounded-xl border border-white/[0.08] text-white/50 hover:text-white/80 hover:bg-white/5 text-[11px] font-semibold transition-all"
                >
                  ← Back
                </button>
                <button
                  onClick={() => onConfirm(true)}
                  disabled={isDeprovisioning}
                  className="flex-1 py-2 rounded-xl bg-white/[0.07] border border-white/[0.10] text-white/70 hover:bg-white/[0.12] text-[11px] font-semibold transition-all disabled:opacity-30"
                >
                  Confirm
                </button>
              </div>
            </>
          ) : (
            /* PROVISIONED — Step 2: token */
            <>
              <p className="text-[11px] text-white/50 leading-relaxed">
                Type the confirmation code to permanently delete this resource:
              </p>
              <div
                className="rounded-xl border border-white/[0.06] py-3 text-center"
                style={{ background: "var(--app-surface)" }}
              >
                <code className="text-[22px] font-mono font-bold tracking-[0.35em] text-red-400 select-none">
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
                className="w-full bg-transparent border border-white/[0.07] rounded-xl py-2.5 px-3 text-[14px] font-mono font-bold text-center text-white/85 tracking-[0.3em] focus:outline-none focus:border-red-500/30 focus:ring-1 focus:ring-red-500/15 transition-all placeholder:text-white/18 placeholder:tracking-normal placeholder:font-normal placeholder:text-[12px]"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setStep(1);
                    setInputToken("");
                  }}
                  className="flex-1 py-2 rounded-xl border border-white/[0.08] text-white/50 hover:text-white/80 hover:bg-white/5 text-[11px] font-semibold transition-all"
                >
                  ← Back
                </button>
                <button
                  onClick={() => onConfirm(false)}
                  disabled={!tokenMatch || isDeprovisioning}
                  className="flex-1 py-2 rounded-xl bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/22 text-[11px] font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
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
