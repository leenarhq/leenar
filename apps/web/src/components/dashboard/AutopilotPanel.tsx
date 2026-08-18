import { useState } from "react";
import { Bot, Check, X, Loader2 } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import type { AutopilotLevel, AutopilotAction } from "../../lib/api";
import { setAutopilotPolicy, decideAutopilotAction } from "../../lib/api";
import { Panel, EmptyRow } from "./Panel";
import { Row } from "../console/Rows";

const LEVELS: { key: AutopilotLevel; label: string }[] = [
  { key: "observe", label: "Observe" },
  { key: "suggest", label: "Suggest" },
  { key: "auto_safe", label: "Auto (safe)" },
  { key: "full", label: "Full" },
];

export function AutopilotPanel({
  projectId,
  level,
  actions,
  session,
  onLevelChange,
  onActionsChange,
}: {
  projectId: string;
  level: AutopilotLevel;
  actions: AutopilotAction[];
  session: Session | null;
  onLevelChange: (level: AutopilotLevel) => void;
  onActionsChange: (
    updater: (prev: AutopilotAction[]) => AutopilotAction[],
  ) => void;
}) {
  const [savingLevel, setSavingLevel] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const changeLevel = async (next: AutopilotLevel) => {
    if (!session || next === level) return;
    onLevelChange(next);
    setSavingLevel(true);
    try {
      await setAutopilotPolicy(projectId, next, session);
    } finally {
      setSavingLevel(false);
    }
  };

  const decide = async (
    action: AutopilotAction,
    decision: "approved" | "rejected",
  ) => {
    if (!session) return;
    setBusy(action.id);
    try {
      await decideAutopilotAction(projectId, action.id, decision, session);
      onActionsChange((prev) =>
        prev.map((a) =>
          a.id === action.id
            ? {
                ...a,
                status: decision === "approved" ? "executed" : "rejected",
              }
            : a,
        ),
      );
    } finally {
      setBusy(null);
    }
  };

  const pending = actions.filter((a) => a.status === "pending");

  return (
    <Panel
      title="Autopilot"
      icon={Bot}
      action={
        savingLevel ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        ) : null
      }
      bodyClassName="p-0"
    >
      {/* The control sizes to its labels rather than stretching: a segmented
          control spanning a full-width panel reads as four buttons, not as
          one setting with four positions. */}
      <div className="border-b border-border-soft p-3">
        <div className="inline-flex items-center gap-0.5 rounded-full border border-border-soft p-0.5">
          {LEVELS.map((l) => (
            <button
              key={l.key}
              onClick={() => changeLevel(l.key)}
              className={`rounded-full px-3 py-1 font-mono text-[10px] lowercase transition-colors ${
                level === l.key
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {pending.length === 0 ? (
        <EmptyRow>No pending actions</EmptyRow>
      ) : (
        <div>
          {pending.map((a) => (
            <Row key={a.id}>
              <span className="flex-1 truncate font-mono text-[12px] lowercase">
                {a.action_type.replace(/_/g, " ")}
              </span>
              {/* No hue on approve/reject: an action is not a state, and the
                  icons already say which is which (spec D3). */}
              <button
                onClick={() => decide(a, "approved")}
                disabled={busy === a.id}
                aria-label="Approve"
                className="rounded-full border border-border-soft p-1 transition-colors hover:bg-secondary disabled:opacity-50"
              >
                {busy === a.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
              </button>
              <button
                onClick={() => decide(a, "rejected")}
                disabled={busy === a.id}
                aria-label="Reject"
                className="rounded-full border border-border-soft p-1 transition-colors hover:bg-secondary disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            </Row>
          ))}
        </div>
      )}
    </Panel>
  );
}
