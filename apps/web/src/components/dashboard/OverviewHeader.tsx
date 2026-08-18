import { RefreshCw, X, Loader2 } from "lucide-react";
import type { ProjectSummary } from "../../lib/workflows";
import { timeAgo } from "../../lib/utils";

/**
 * The project's name and status are NOT repeated here: ProjectContextBar
 * renders both in the PageBar directly above this row, as a
 * `project / section` crumb with a StateTag. What is left is the deploy
 * metadata and the single action the screen offers.
 */
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
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="font-mono text-[11px] lowercase tabular-nums text-muted-foreground">
        {summary.last_deployed_at
          ? `deployed ${timeAgo(new Date(summary.last_deployed_at).getTime())} · ${summary.deploy_count} deploys`
          : "never deployed"}
      </p>
      {activeSession ? (
        <button
          onClick={onCancel}
          disabled={cancelling}
          className="inline-flex items-center gap-1.5 rounded-full border border-crit/30 px-3.5 py-1.5 text-[13px] text-crit transition-colors hover:bg-crit/10 disabled:opacity-50"
        >
          {cancelling ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <X className="h-3.5 w-3.5" />
          )}
          Cancel
        </button>
      ) : (
        <button
          onClick={onRedeploy}
          disabled={redeploying}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {redeploying ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Redeploy
        </button>
      )}
    </div>
  );
}
