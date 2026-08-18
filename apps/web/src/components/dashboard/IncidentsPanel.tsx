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
import { Mono, Dim } from "../console/Rows";
import { StateTag, toneFor } from "../console/StateTag";

/** `5xx` is not a word toneFor can read; every other severity is. */
const sevTone = (s: string) => (s === "5xx" ? "crit" : toneFor(s));

/** One shape for every row action on this surface. */
const ACTION =
  "inline-flex items-center gap-1 rounded-full border border-border-soft px-2 py-0.5 font-mono text-[10px] lowercase transition-colors hover:bg-secondary disabled:opacity-50";

export function IncidentsPanel({
  incidents,
  session,
  onIncidentsChange,
}: {
  incidents: Incident[];
  session: Session | null;
  onIncidentsChange: (updater: (prev: Incident[]) => Incident[]) => void;
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
        <div>
          {incidents.map((inc) => (
            <div
              key={inc.id}
              className="border-b border-border-soft px-4 py-3 text-[13px] last:border-b-0"
            >
              <div className="flex items-center gap-2">
                <StateTag tone={sevTone(inc.severity)} label={inc.severity} />
                <Mono>{inc.service}</Mono>
                {inc.status === "acknowledged" && (
                  <span className="rounded-full border border-border-soft px-2 py-0.5 font-mono text-[10px] lowercase text-dim">
                    ack
                  </span>
                )}
                <span className="ml-auto">
                  <Dim>{timeAgo(inc.last_seen_at)}</Dim>
                </span>
              </div>
              {inc.log_snippet && (
                <p className="mt-1.5 truncate text-muted-foreground">
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
                    className={ACTION}
                  >
                    {busy === inc.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="h-3 w-3" />
                    )}
                    ack
                  </button>
                )}
                <button
                  onClick={() => act(inc, resolveIncident, "resolved")}
                  disabled={busy === inc.id}
                  className={ACTION}
                >
                  <X className="h-3 w-3" /> resolve
                </button>
                <button
                  onClick={() => diagnose(inc)}
                  disabled={busy === inc.id}
                  className={ACTION}
                >
                  <Stethoscope className="h-3 w-3" /> diagnose
                </button>
              </div>
              {diag[inc.id] && (
                <p className="mt-2 whitespace-pre-line rounded-xl border border-border-soft bg-secondary px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
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
