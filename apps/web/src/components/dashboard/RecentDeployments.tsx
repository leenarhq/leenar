import { useState } from "react";
import { CloudUpload, RotateCcw, Loader2 } from "lucide-react";
import type { DeploymentSummary } from "../../lib/api";
import { timeAgo, duration } from "../../lib/format";
import { Panel, EmptyRow } from "./Panel";
import { Row, Mono, Dim } from "../console/Rows";
import { StateDot, toneFor } from "../console/StateTag";

export function RecentDeployments({
  deployments,
  onRollback,
}: {
  deployments: DeploymentSummary[];
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
    <Panel title="Recent deployments" icon={CloudUpload} bodyClassName="p-0">
      {deployments.length === 0 ? (
        <EmptyRow>No deployments yet</EmptyRow>
      ) : (
        // Rows' own rounded border would double the Panel's, so the rows are
        // rendered bare inside the panel body.
        <div>
          {deployments.map((d, i) => (
            <Row key={d.id}>
              <StateDot tone={toneFor(d.status)} />
              <Mono>{d.id.slice(0, 8)}</Mono>
              <span className="w-20 lowercase">{d.status}</span>
              <span className="flex-1 text-muted-foreground">
                {d.started_at ? timeAgo(d.started_at) : "—"}
              </span>
              <Dim>{duration(d.started_at, d.finished_at)}</Dim>
              {i > 0 && d.status === "success" && (
                <button
                  onClick={() => rollback(d.id)}
                  disabled={busy === d.id}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border-soft px-2 py-0.5 font-mono text-[10px] lowercase text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                >
                  {busy === d.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3 w-3" />
                  )}
                  rollback
                </button>
              )}
            </Row>
          ))}
        </div>
      )}
    </Panel>
  );
}
