import { useState } from "react";
import { GitCompareArrows, Wrench, EyeOff, Loader2 } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import type { StackDrift } from "../../lib/api";
import { ignoreDrift, reconcileDrift } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { Panel, EmptyRow } from "./Panel";
import { Mono, Dim } from "../console/Rows";
import { StateTag } from "../console/StateTag";

/** One shape for every row action on this surface. */
const ACTION =
  "inline-flex items-center gap-1 rounded-full border border-border-soft px-2 py-0.5 font-mono text-[10px] lowercase transition-colors hover:bg-secondary disabled:opacity-50";

export function DriftPanel({
  drifts,
  session,
  onDriftsChange,
}: {
  drifts: StackDrift[];
  session: Session | null;
  onDriftsChange: (updater: (prev: StackDrift[]) => StackDrift[]) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (
    drift: StackDrift,
    fn: (id: string, s: Session, source?: string) => Promise<void>,
  ) => {
    if (!session) return;
    setBusy(drift.id);
    try {
      await fn(drift.id, session, "dashboard");
      onDriftsChange((prev) => prev.filter((d) => d.id !== drift.id));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      title="Infrastructure Drift"
      icon={GitCompareArrows}
      bodyClassName="p-0"
    >
      {drifts.length === 0 ? (
        <EmptyRow>No drift detected</EmptyRow>
      ) : (
        <div>
          {drifts.map((d) => (
            <div
              key={d.id}
              className="border-b border-border-soft px-4 py-3 text-[13px] last:border-b-0"
            >
              <div className="flex items-center gap-2">
                {/* `warn` is fixed, not derived: every drift is a drift. The
                    type names the field that moved, not a severity, so
                    toneFor("resource_missing") would read idle. */}
                <StateTag tone="warn" label={d.drift_type.replace(/_/g, " ")} />
                <Mono>{d.service}</Mono>
                <span className="ml-auto">
                  <Dim>{timeAgo(d.detected_at)}</Dim>
                </span>
              </div>
              <p className="mt-1.5 truncate text-muted-foreground">
                <span className="font-mono">{d.field}</span> drifted on{" "}
                <span className="font-mono">{d.resource_id}</span>
              </p>
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  onClick={() => act(d, reconcileDrift)}
                  disabled={busy === d.id}
                  className={ACTION}
                >
                  {busy === d.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Wrench className="h-3 w-3" />
                  )}
                  reconcile
                </button>
                <button
                  onClick={() => act(d, ignoreDrift)}
                  disabled={busy === d.id}
                  className={ACTION}
                >
                  <EyeOff className="h-3 w-3" /> ignore
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
