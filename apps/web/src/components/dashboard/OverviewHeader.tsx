import { RefreshCw, X, Loader2 } from "lucide-react";
import type { ProjectSummary } from "../../lib/workflows";
import { timeAgo } from "../../lib/utils";
import { StatusDot } from "./Panel";
import { statusLabel } from "../../lib/labels";

const statusTone: Record<string, string> = {
  active: "success",
  draft: "neutral",
  error: "error",
};

export function OverviewHeader({
  summary,
  activeSession,
  onRedeploy,
  onCancel,
  redeploying,
  cancelling,
}: {
  summary: ProjectSummary | null;
  activeSession: { stackId: string; sessionId: string } | null;
  onRedeploy: () => void;
  onCancel: () => void;
  redeploying: boolean;
  cancelling: boolean;
}) {
  if (!summary) return null;
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-card px-5 py-4">
      <div>
        <div className="flex items-center gap-2">
          <StatusDot tone={statusTone[summary.status] ?? "neutral"} />
          <h1 className="text-2xl font-semibold">{summary.name}</h1>
          <span className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
            {statusLabel(summary.status)}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {summary.last_deployed_at
            ? `Last deployed ${timeAgo(new Date(summary.last_deployed_at).getTime())} · ${summary.deploy_count} deploys`
            : "Never deployed"}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {activeSession ? (
          <button
            onClick={onCancel}
            disabled={cancelling}
            className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            {cancelling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}{" "}
            Cancel
          </button>
        ) : (
          <button
            onClick={onRedeploy}
            disabled={redeploying}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {redeploying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}{" "}
            Redeploy
          </button>
        )}
      </div>
    </div>
  );
}
