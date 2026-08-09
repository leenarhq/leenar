import { useEffect, useState, useCallback } from "react";
import { Bell, Plus, Trash2, Loader2 } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import {
  listAlertRules,
  createAlertRule,
  deleteAlertRule,
  updateAlertRule,
  type AlertRule,
  type AlertMetric,
  type AlertOperator,
  type AlertChannel,
} from "../../lib/api";
import { Panel, EmptyRow } from "./Panel";

const METRIC_LABEL: Record<AlertMetric, string> = {
  cost_month_usd: "Monthly cost ($)",
  uptime_percent: "Uptime (%)",
  error_rate: "Error rate (0–1)",
};
const OP_LABEL: Record<AlertOperator, string> = {
  gt: ">",
  lt: "<",
  gte: "≥",
  lte: "≤",
};

export function AlertRulesPanel({
  projectId,
  session,
}: {
  projectId: string;
  session: Session | null;
}) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const [metric, setMetric] = useState<AlertMetric>("cost_month_usd");
  const [operator, setOperator] = useState<AlertOperator>("gt");
  const [threshold, setThreshold] = useState("");
  const [channel, setChannel] = useState<AlertChannel>("email");

  const load = useCallback(async () => {
    if (!session) return;
    const r = await listAlertRules(projectId, session).catch(() => []);
    setRules(r);
    setLoading(false);
  }, [projectId, session]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!session || threshold.trim() === "") return;
    setAdding(true);
    try {
      await createAlertRule(
        { projectId, metric, operator, threshold: Number(threshold), channel },
        session,
      );
      setThreshold("");
      await load();
    } finally {
      setAdding(false);
    }
  };

  const remove = async (id: string) => {
    if (!session) return;
    await deleteAlertRule(id, session);
    setRules((r) => r.filter((x) => x.id !== id));
  };

  const toggle = async (rule: AlertRule) => {
    if (!session) return;
    await updateAlertRule(rule.id, { enabled: !rule.enabled }, session);
    setRules((r) =>
      r.map((x) => (x.id === rule.id ? { ...x, enabled: !x.enabled } : x)),
    );
  };

  return (
    <Panel title="Alert rules" icon={Bell}>
      {loading ? (
        <EmptyRow>Loading…</EmptyRow>
      ) : (
        <div className="space-y-3">
          {rules.length === 0 ? (
            <EmptyRow>No alert rules yet</EmptyRow>
          ) : (
            <ul className="space-y-2">
              {rules.map((rule) => (
                <li
                  key={rule.id}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="truncate">
                    <span className="font-mono">
                      {METRIC_LABEL[rule.metric]} {OP_LABEL[rule.operator]}{" "}
                      {rule.threshold}
                    </span>
                    <span className="ml-2 text-muted-foreground">
                      → {rule.channel}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <button
                      onClick={() => toggle(rule)}
                      className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
                        rule.enabled
                          ? "text-emerald-400"
                          : "text-muted-foreground"
                      }`}
                    >
                      {rule.enabled ? "on" : "off"}
                    </button>
                    <button
                      onClick={() => remove(rule.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as AlertMetric)}
              className="rounded border border-border bg-secondary/30 px-1.5 py-1 text-xs"
            >
              {(Object.keys(METRIC_LABEL) as AlertMetric[]).map((m) => (
                <option key={m} value={m}>
                  {METRIC_LABEL[m]}
                </option>
              ))}
            </select>
            <select
              value={operator}
              onChange={(e) => setOperator(e.target.value as AlertOperator)}
              className="rounded border border-border bg-secondary/30 px-1.5 py-1 text-xs"
            >
              {(Object.keys(OP_LABEL) as AlertOperator[]).map((o) => (
                <option key={o} value={o}>
                  {OP_LABEL[o]}
                </option>
              ))}
            </select>
            <input
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              inputMode="decimal"
              placeholder="value"
              className="w-16 rounded border border-border bg-secondary/30 px-1.5 py-1 text-xs"
            />
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as AlertChannel)}
              className="rounded border border-border bg-secondary/30 px-1.5 py-1 text-xs"
            >
              <option value="email">email</option>
              <option value="slack">slack</option>
            </select>
            <button
              onClick={add}
              disabled={adding || threshold.trim() === ""}
              className="inline-flex items-center gap-1 rounded bg-foreground px-2 py-1 text-xs text-background hover:opacity-90 disabled:opacity-50"
            >
              {adding ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}
