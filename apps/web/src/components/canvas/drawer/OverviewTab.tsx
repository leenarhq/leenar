import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { IconRenderer, Field, inputCls } from "../Sidebar";
import { LivePreview } from "../ServiceDrawer";

interface OverviewTabProps {
  node: any;
  localData: any;
  handleUpdate: (field: string, value: any) => void;
  isProvisioned: boolean;
  onRedeploy?: (nodeId: string) => Promise<void>;
}

export function OverviewTab({
  node,
  localData,
  handleUpdate,
  isProvisioned,
  onRedeploy,
}: OverviewTabProps) {
  const provider = localData.provider;

  // ── Redeploy state (moved verbatim from SidebarAdvanced.tsx) ──
  const [redeploying, setRedeploying] = useState(false);

  if (!node) return null;

  return (
    <div className="space-y-4">
      {isProvisioned && (
        <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/15 space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-400/60 mb-1">
            Provisioned Resources
          </p>
          {localData.provisionedUrl && (
            <>
              {provider === "vercel" && (
                <LivePreview url={localData.provisionedUrl as string} />
              )}
              <a
                href={localData.provisionedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg bg-emerald-500/12 border border-emerald-500/25 text-emerald-400 text-[13px] font-semibold hover:bg-emerald-500/20 transition-all"
              >
                <IconRenderer iconName="ExternalLink" size={11} />
                Open App
              </a>
            </>
          )}
          {localData.vercelProjectId && (
            <p className="text-[11px] font-mono text-white/30">
              id: {localData.vercelProjectId}
            </p>
          )}
          {localData.supabaseProjectRef && (
            <p className="text-[11px] font-mono text-white/30">
              ref: {localData.supabaseProjectRef}
            </p>
          )}
        </div>
      )}

      {/* Label — always shown */}
      <Field label="Label" hint="Display name shown on the canvas node card.">
        <input
          type="text"
          value={localData.label || ""}
          onChange={(e) => handleUpdate("label", e.target.value)}
          disabled={isProvisioned}
          className={inputCls(isProvisioned)}
        />
      </Field>

      {/* Redeploy — only when provisioned and it's a Vercel project */}
      {isProvisioned && localData.vercelProjectId && onRedeploy && node && (
        <button
          type="button"
          disabled={redeploying}
          onClick={async () => {
            setRedeploying(true);
            try {
              await onRedeploy(node.id);
            } finally {
              setRedeploying(false);
            }
          }}
          className="flex items-center gap-1.5 text-[12px] text-white/60 hover:text-white/90 disabled:opacity-40 transition-colors"
        >
          {redeploying ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {redeploying ? "Deploying…" : "Redeploy"}
        </button>
      )}
    </div>
  );
}
