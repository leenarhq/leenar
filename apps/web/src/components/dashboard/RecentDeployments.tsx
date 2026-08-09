import { useState } from "react";
import { CloudUpload, RotateCcw, Loader2 } from "lucide-react";
import type { DeploymentSummary } from "../../lib/api";
import { timeAgo, duration } from "../../lib/format";
import { Panel, EmptyRow, StatusDot } from "./Panel";

const statusTone: Record<string, string> = {
  success: "success",
  failed: "error",
  cancelled: "neutral",
  running: "warning",
  queued: "warning",
};

export function RecentDeployments({
  deployments,
  onRollback,
}: {
  deployments: DeploymentSummary[];
  projectId: string;
  onRollback: (deploymentId: string) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const rollback = async (deploymentId: string) => {
    if (!window.confirm("Roll back to this deployment?")) return;
    setBusy(deploymentId);
    try {
      await onRollback(deploymentId);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="Recent Deployments" icon={CloudUpload} bodyClassName="p-0">
      {deployments.length === 0 ? (
        <EmptyRow>No deployments yet</EmptyRow>
      ) : (
        <div className="divide-y divide-border">
          {deployments.map((d, i) => (
            <div
              key={d.id}
              className="flex items-center gap-3 px-4 py-2.5 text-xs"
            >
              <StatusDot tone={statusTone[d.status] ?? "neutral"} />
              <span className="w-16 truncate font-mono text-muted-foreground">
                {d.id.slice(0, 8)}
              </span>
              <span className="w-16 capitalize">{d.status}</span>
              <span className="flex-1 text-muted-foreground">
                {d.started_at ? timeAgo(d.started_at) : "—"}
              </span>
              <span className="w-12 text-right text-muted-foreground">
                {duration(d.started_at, d.finished_at)}
              </span>
              {i > 0 && d.status === "success" && (
                <button
                  onClick={() => rollback(d.id)}
                  disabled={busy === d.id}
                  className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  {busy === d.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3 w-3" />
                  )}{" "}
                  Rollback
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
