import { toast } from "sonner";

const SUPABASE_DB_LIMIT = 500 * 1024 * 1024; // 500 MB
const SUPABASE_MAU_LIMIT = 50_000;
const WARN_THRESHOLD = 0.8;
const ANOMALY_MIN_READINGS = 3;
const ANOMALY_MULTIPLIER = 2;
const PREDICTIVE_SHOW_THRESHOLD = 0.6;
const SMART_QUOTA_HOURS = 48;

export interface UsageReading {
  db_size?: number;
  mau?: number;
  timestamp: number;
}

export const MAX_HISTORY = 24; // 2 hours at 5-min poll

export function runUsageAlerts(
  nodeId: string,
  label: string,
  current: UsageReading,
  history: UsageReading[], // prior readings, NOT including current
): void {
  checkAnomaly(nodeId, label, current, history);
  checkPredictiveBilling(nodeId, label, current);
  checkSmartQuota(nodeId, label, current, history);
}

function avg(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function checkAnomaly(
  nodeId: string,
  label: string,
  current: UsageReading,
  history: UsageReading[],
): void {
  if (history.length < ANOMALY_MIN_READINGS) return;

  const check = (key: "db_size" | "mau", metricLabel: string) => {
    const curr = current[key];
    if (!curr || curr === 0) return;

    const prior = history
      .map((r) => r[key])
      .filter((v): v is number => v !== undefined && v > 0);
    if (prior.length < ANOMALY_MIN_READINGS) return;

    const mean = avg(prior);
    if (mean === 0) return;

    // Skip if already at warn threshold — existing quota toast covers it
    if (
      curr / (key === "db_size" ? SUPABASE_DB_LIMIT : SUPABASE_MAU_LIMIT) >=
      WARN_THRESHOLD
    )
      return;

    if (curr > mean * ANOMALY_MULTIPLIER) {
      const increase = Math.round((curr / mean - 1) * 100);
      toast.warning(
        `${label}: ${metricLabel} spiked +${increase}% above recent average`,
        { id: `anomaly-${nodeId}-${key}` },
      );
    }
  };

  check("mau", "Supabase MAU");
  check("db_size", "Supabase DB size");
}

function checkPredictiveBilling(
  nodeId: string,
  label: string,
  current: UsageReading,
): void {
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate();
  if (dayOfMonth === 0) return;

  const project = (
    value: number,
    limit: number,
    metricLabel: string,
    format: (v: number) => string,
    key: string,
  ) => {
    if (value === 0) return;
    // Skip if already at warn threshold
    if (value / limit >= WARN_THRESHOLD) return;

    const projected = (value / dayOfMonth) * daysInMonth;
    if (projected <= limit * PREDICTIVE_SHOW_THRESHOLD) return;
    if (projected <= value) return; // sanity: projection must be higher than current

    const pct = Math.round((projected / limit) * 100);
    toast.info(
      `${label}: ${metricLabel} projected at ${format(projected)} by month end (${pct}% of limit)`,
      { id: `predict-${nodeId}-${key}`, duration: 10_000 },
    );
  };

  if (current.db_size !== undefined) {
    project(
      current.db_size,
      SUPABASE_DB_LIMIT,
      "Supabase DB",
      (v) => `${Math.round(v / 1024 / 1024)} MB`,
      "db",
    );
  }

  if (current.mau !== undefined) {
    project(
      current.mau,
      SUPABASE_MAU_LIMIT,
      "Supabase MAU",
      (v) => v.toLocaleString(),
      "mau",
    );
  }
}

function checkSmartQuota(
  nodeId: string,
  label: string,
  current: UsageReading,
  history: UsageReading[],
): void {
  if (history.length < 2) return;

  const oldest = history[0];
  const hoursElapsed = (current.timestamp - oldest.timestamp) / 1000 / 3600;
  if (hoursElapsed < 0.1) return;

  const check = (
    key: "db_size" | "mau",
    limit: number,
    metricLabel: string,
  ) => {
    const curr = current[key];
    const old = oldest[key];
    if (curr === undefined || old === undefined) return;
    if (curr <= old) return; // not growing

    // Skip if already at warn threshold — existing quota toast covers it
    if (curr / limit >= WARN_THRESHOLD) return;

    const hourlyRate = (curr - old) / hoursElapsed;
    if (hourlyRate <= 0) return;

    const hoursUntilLimit = (limit - curr) / hourlyRate;
    if (hoursUntilLimit > 0 && hoursUntilLimit < SMART_QUOTA_HOURS) {
      const h = Math.round(hoursUntilLimit);
      toast.warning(
        `${label}: ${metricLabel} limit at current rate in ~${h}h`,
        { id: `smartquota-${nodeId}-${key}` },
      );
    }
  };

  check("db_size", SUPABASE_DB_LIMIT, "Supabase DB");
  check("mau", SUPABASE_MAU_LIMIT, "Supabase MAU");
}
