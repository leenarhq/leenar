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
        // No ok tint on the container or the heading: a section title is not
        // a state, and the node's own foot line already says `provisioned`.
        <div className="space-y-1.5 rounded-xl border border-border-soft p-3">
          <p className="mb-1 font-mono text-[10px] lowercase text-dim">
            provisioned resources
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
                className="flex w-full items-center justify-center gap-1.5 rounded-full bg-primary py-1.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                <IconRenderer iconName="ExternalLink" size={11} />
                Open App
              </a>
            </>
          )}
          {localData.vercelProjectId && (
            <p className="text-[11px] font-mono text-dim">
              id: {localData.vercelProjectId}
            </p>
          )}
          {localData.supabaseProjectRef && (
            <p className="text-[11px] font-mono text-dim">
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
          className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
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
