import { useEffect } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import type { Node, Edge } from "@xyflow/react";

const PROVIDER_COLOR: Record<string, string> = {
  github: "var(--foreground)",
  vercel: "var(--foreground)",
  supabase: "var(--foreground)",
  resend: "var(--foreground)",
};

// Supabase takes ~3-4 min to provision; Vercel/GitHub/Resend ~30-60s each
const PROVISION_TIME: Record<string, number> = {
  supabase: 3.5,
  vercel: 1,
  github: 0.5,
  resend: 0.5,
};

const COST_TIERS: Record<
  string,
  { tier: string; monthly: string; upgradeAt: string }
> = {
  github: {
    tier: "Free",
    monthly: "$0",
    upgradeAt: "Team features / 3K CI min",
  },
  vercel: { tier: "Hobby", monthly: "$0", upgradeAt: "100 GB bandwidth" },
  supabase: { tier: "Free", monthly: "$0", upgradeAt: "50K MAU · 500 MB DB" },
  resend: { tier: "Free", monthly: "$0", upgradeAt: "3K emails / mo" },
};

interface PreDeployModalProps {
  nodes: Node[];
  edges: Edge[];
  onConfirm: () => void;
  onClose: () => void;
  targetEnvName?: string | null;
}

export function PreDeployModal({
  nodes,
  edges,
  onConfirm,
  onClose,
  targetEnvName,
}: PreDeployModalProps) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onConfirm();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, onConfirm]);

  const serviceNodes = nodes.filter((n) => n.type === "service");
  const toProvision = serviceNodes.filter(
    (n) => (n.data as Record<string, unknown>)?.status !== "provisioned",
  );
  const alreadyDone = serviceNodes.filter(
    (n) => (n.data as Record<string, unknown>)?.status === "provisioned",
  );
  const envEdges = edges.filter(
    (e) =>
      ((e.data as Record<string, unknown>)?.envVars as string[] | undefined)
        ?.length,
  );

  const label = (n: Node) =>
    ((n.data as Record<string, unknown>)?.label as string | undefined) ?? n.id;
  const provider = (n: Node) =>
    ((n.data as Record<string, unknown>)?.provider as string | undefined) ?? "";

  const estimatedMinutes = toProvision.reduce((acc, n) => {
    return acc + (PROVISION_TIME[provider(n)] ?? 1);
  }, 0);
  const timeLabel =
    estimatedMinutes === 0
      ? null
      : estimatedMinutes < 1
        ? "< 1 min"
        : `~${Math.round(estimatedMinutes)} min`;

  if (toProvision.length === 0 && alreadyDone.length === 0) {
    toast.error("Add at least one service to the canvas before deploying.");
    onClose();
    return null;
  }

  return (
    <motion.div
      className="absolute inset-0 z-50 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div
        className="relative z-10 w-96 overflow-hidden rounded-2xl border border-border-soft shadow-[var(--raise-lg)]"
        style={{ background: "var(--popover)" }}
        initial={{ scale: 0.95, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 10 }}
        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-soft">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold text-foreground tracking-tight">
                Ready to deploy?
              </h2>
              {targetEnvName && (
                <span className="rounded-full border border-border-soft px-2 py-0.5 font-mono text-[11px] lowercase text-muted-foreground">
                  {targetEnvName}
                </span>
              )}
            </div>
            <p className="text-[13px] text-dim mt-0.5">
              {toProvision.length === 0
                ? "All services already provisioned"
                : `${toProvision.length} service${toProvision.length !== 1 ? "s" : ""} will be provisioned`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-dim hover:text-muted-foreground hover:bg-secondary transition-all"
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
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-72 overflow-y-auto">
          {/* To provision */}
          {toProvision.length > 0 && (
            <div>
              <p className="text-[11px] font-mono lowercase text-dim mb-2">
                Will provision
              </p>
              <div className="space-y-1.5">
                {toProvision.map((n) => (
                  <div
                    key={n.id}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-[var(--hover)] border border-border-soft"
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{
                        background:
                          PROVIDER_COLOR[provider(n)] ??
                          "var(--muted-foreground)",
                      }}
                    />
                    <span className="text-[14px] text-foreground flex-1">
                      {label(n)}
                    </span>
                    <span className="text-[12px] font-mono text-dim capitalize">
                      {provider(n)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Already provisioned */}
          {alreadyDone.length > 0 && (
            <div>
              <p className="text-[11px] font-mono lowercase text-dim mb-2">
                Already provisioned (skip)
              </p>
              <div className="space-y-1.5">
                {alreadyDone.map((n) => (
                  <div
                    key={n.id}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-[var(--hover)] border border-border-soft opacity-50"
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--ok)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    <span className="text-[14px] text-muted-foreground flex-1">
                      {label(n)}
                    </span>
                    <span className="text-[12px] font-mono text-dim capitalize">
                      {provider(n)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Env var injections */}
          {envEdges.length > 0 && (
            <div>
              <p className="text-[11px] font-mono lowercase text-dim mb-2">
                Env vars to inject
              </p>
              <div className="space-y-1">
                {envEdges.map((e) => {
                  const vars = (e.data as Record<string, unknown>)
                    ?.envVars as string[];
                  const src = nodes.find((n) => n.id === e.source);
                  const tgt = nodes.find((n) => n.id === e.target);
                  return (
                    <div
                      key={e.id}
                      className="flex items-start gap-2 px-3 py-1.5 rounded-lg bg-[var(--hover)] border border-border-soft"
                    >
                      <svg
                        width="9"
                        height="9"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--muted-foreground)"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="mt-0.5 flex-shrink-0"
                      >
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                      <div className="flex-1 min-w-0">
                        <span className="text-[12px] text-dim">
                          {src ? label(src) : e.source} →{" "}
                          {tgt ? label(tgt) : e.target}
                        </span>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {vars.slice(0, 4).map((v) => (
                            <code
                              key={v}
                              className="text-[11px] px-1 py-0.5 rounded bg-[var(--hover)] text-muted-foreground font-mono"
                            >
                              {v}
                            </code>
                          ))}
                          {vars.length > 4 && (
                            <span className="text-[11px] text-dim">
                              +{vars.length - 4} more
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Cost estimate */}
        {toProvision.length > 0 && (
          <div className="px-5 pb-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-mono lowercase text-dim">
                Estimated cost
              </p>
              {timeLabel && (
                <span className="text-[11px] text-dim font-mono">
                  ~{timeLabel} to provision
                </span>
              )}
            </div>
            <div className="rounded-xl border border-border-soft overflow-hidden">
              {toProvision.map((n, i) => {
                const p = provider(n);
                const tier = COST_TIERS[p];
                if (!tier) return null;
                return (
                  <div
                    key={n.id}
                    className={`flex items-center gap-2.5 px-3 py-2 ${i > 0 ? "border-t border-border-soft" : ""}`}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{
                        background: PROVIDER_COLOR[p] ?? "var(--dim)",
                      }}
                    />
                    <span className="text-[13px] text-muted-foreground flex-1 capitalize">
                      {p}
                    </span>
                    <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-[var(--hover)] text-dim font-mono">
                      {tier.tier}
                    </span>
                    <span className="w-6 text-right text-[13px] font-medium text-foreground">
                      {tier.monthly}
                    </span>
                  </div>
                );
              })}
              <div className="flex items-center justify-between px-3 py-2 border-t border-border-soft bg-[var(--hover)]">
                <span className="text-[11px] text-dim font-mono lowercase">
                  Total
                </span>
                <span className="text-[14px] text-foreground">$0 / mo</span>
              </div>
            </div>
            {/* Upgrade triggers */}
            {(() => {
              const triggers = toProvision
                .map((n) => {
                  const t = COST_TIERS[provider(n)];
                  return t ? { p: provider(n), at: t.upgradeAt } : null;
                })
                .filter(Boolean) as { p: string; at: string }[];
              if (triggers.length === 0) return null;
              return (
                <div className="space-y-1">
                  <p className="text-[11px] font-mono lowercase text-dim">
                    Paid tier kicks in when
                  </p>
                  {triggers.map(({ p, at }) => (
                    <p key={p} className="text-[11px] text-dim font-mono">
                      <span className="text-dim capitalize">{p}:</span> {at}
                    </p>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-border-soft bg-[var(--hover)]">
          <span className="text-[12px] text-dim font-mono">⌘↵ to confirm</span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-[var(--hover)] transition-all"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="rounded-full bg-primary px-4 py-1.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Deploy now
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
