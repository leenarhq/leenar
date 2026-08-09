import { useState } from "react";
import { GitCompareArrows, Wrench, EyeOff, Loader2 } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import type { StackDrift } from "../../lib/api";
import { ignoreDrift, reconcileDrift } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { Panel, EmptyRow } from "./Panel";

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
        <div className="divide-y divide-border">
          {drifts.map((d) => (
            <div key={d.id} className="px-4 py-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-mono uppercase text-yellow-500">
                  {d.drift_type.replace(/_/g, " ")}
                </span>
                <span className="font-mono text-muted-foreground">
                  {d.service}
                </span>
                <span className="ml-auto text-muted-foreground">
                  {timeAgo(d.detected_at)}
                </span>
              </div>
              <p className="mt-1 truncate text-muted-foreground">
                <span className="font-mono">{d.field}</span> drifted on{" "}
                <span className="font-mono">{d.resource_id}</span>
              </p>
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  onClick={() => act(d, reconcileDrift)}
                  disabled={busy === d.id}
                  className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-secondary disabled:opacity-50"
                >
                  {busy === d.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Wrench className="h-3 w-3" />
                  )}{" "}
                  Reconcile
                </button>
                <button
                  onClick={() => act(d, ignoreDrift)}
                  disabled={busy === d.id}
                  className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-secondary disabled:opacity-50"
                >
                  <EyeOff className="h-3 w-3" /> Ignore
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
