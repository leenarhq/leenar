import { useState } from "react";
import { AlertTriangle, Check, X, Stethoscope, Loader2 } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import type { Incident } from "../../lib/api";
import {
  acknowledgeIncident,
  resolveIncident,
  diagnoseIncident,
} from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { Panel, EmptyRow } from "./Panel";

const sevColor: Record<string, string> = {
  "5xx": "text-destructive",
  error: "text-destructive",
  warning: "text-yellow-500",
  down: "text-destructive",
};

export function IncidentsPanel({
  incidents,
  session,
  onIncidentsChange,
}: {
  incidents: Incident[];
  session: Session | null;
  onIncidentsChange: (updater: (prev: Incident[]) => Incident[]) => void;
  projectId: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [diag, setDiag] = useState<Record<string, string>>({});

  const act = async (
    inc: Incident,
    fn: (id: string, s: Session, source?: string) => Promise<void>,
    newStatus: Incident["status"],
  ) => {
    if (!session) return;
    setBusy(inc.id);
    try {
      await fn(inc.id, session, "dashboard");
      onIncidentsChange((prev) =>
        newStatus === "resolved"
          ? prev.filter((i) => i.id !== inc.id)
          : prev.map((i) =>
              i.id === inc.id ? { ...i, status: newStatus } : i,
            ),
      );
    } finally {
      setBusy(null);
    }
  };

  const diagnose = async (inc: Incident) => {
    if (!session) return;
    setBusy(inc.id);
    try {
      const res = await diagnoseIncident(inc, session);
      setDiag((d) => ({
        ...d,
        [inc.id]: `Cause: ${res.cause}\nFix: ${res.fix}`,
      }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="Incidents" icon={AlertTriangle} bodyClassName="p-0">
      {incidents.length === 0 ? (
        <EmptyRow>No open incidents</EmptyRow>
      ) : (
        <div className="divide-y divide-border">
          {incidents.map((inc) => (
            <div key={inc.id} className="px-4 py-3 text-xs">
              <div className="flex items-center gap-2">
                <span
                  className={`font-mono uppercase ${sevColor[inc.severity] ?? "text-muted-foreground"}`}
                >
                  {inc.severity}
                </span>
                <span className="font-mono text-muted-foreground">
                  {inc.service}
                </span>
                {inc.status === "acknowledged" && (
                  <span className="rounded bg-secondary px-1.5 text-[9px]">
                    ACK
                  </span>
                )}
                <span className="ml-auto text-muted-foreground">
                  {timeAgo(inc.last_seen_at)}
                </span>
              </div>
              {inc.log_snippet && (
                <p className="mt-1 truncate text-muted-foreground">
                  {inc.log_snippet}
                </p>
              )}
              <div className="mt-2 flex items-center gap-1.5">
                {inc.status === "open" && (
                  <button
                    onClick={() =>
                      act(inc, acknowledgeIncident, "acknowledged")
                    }
                    disabled={busy === inc.id}
                    className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-secondary disabled:opacity-50"
                  >
                    {busy === inc.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="h-3 w-3" />
                    )}{" "}
                    Ack
                  </button>
                )}
                <button
                  onClick={() => act(inc, resolveIncident, "resolved")}
                  disabled={busy === inc.id}
                  className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-secondary disabled:opacity-50"
                >
                  <X className="h-3 w-3" /> Resolve
                </button>
                <button
                  onClick={() => diagnose(inc)}
                  disabled={busy === inc.id}
                  className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-secondary disabled:opacity-50"
                >
                  <Stethoscope className="h-3 w-3" /> Diagnose
                </button>
              </div>
              {diag[inc.id] && (
                <p className="mt-2 whitespace-pre-line rounded border border-border bg-secondary/30 p-2 text-[11px] leading-relaxed text-muted-foreground">
                  {diag[inc.id]}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
