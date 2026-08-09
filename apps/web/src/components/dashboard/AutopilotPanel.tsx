import { useState } from "react";
import { Bot, Check, X, Loader2 } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import type { AutopilotLevel, AutopilotAction } from "../../lib/api";
import { setAutopilotPolicy, decideAutopilotAction } from "../../lib/api";
import { Panel, EmptyRow } from "./Panel";

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
    >
      <div className="mb-3 flex items-center gap-1 rounded-md border border-border p-0.5">
        {LEVELS.map((l) => (
          <button
            key={l.key}
            onClick={() => changeLevel(l.key)}
            className={`flex-1 rounded px-2 py-1 text-[11px] transition-colors ${
              level === l.key
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      {pending.length === 0 ? (
        <EmptyRow>No pending actions</EmptyRow>
      ) : (
        <ul className="space-y-2">
          {pending.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded border border-border px-3 py-2 text-xs"
            >
              <span className="flex-1 font-mono">
                {a.action_type.replace(/_/g, " ")}
              </span>
              <button
                onClick={() => decide(a, "approved")}
                disabled={busy === a.id}
                className="rounded border border-border p-1 hover:bg-secondary disabled:opacity-50"
              >
                {busy === a.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3 text-emerald-400" />
                )}
              </button>
              <button
                onClick={() => decide(a, "rejected")}
                disabled={busy === a.id}
                className="rounded border border-border p-1 hover:bg-secondary disabled:opacity-50"
              >
                <X className="h-3 w-3 text-destructive" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
