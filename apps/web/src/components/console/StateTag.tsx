/**
 * The console's only status vocabulary.
 *
 * Four tones, three of which carry a hue. `idle` deliberately does not:
 * a draft project or a rolled-back deploy is not a state anyone needs to
 * be alerted to, and giving it colour is what made the old console read as
 * a colour chart. See DESIGN.md § Console.
 */
export type Tone = "ok" | "warn" | "crit" | "idle";

const OK = [
  "active",
  "live",
  "ready",
  "success",
  "provisioned",
  "connected",
  "resolved",
];
const WARN = [
  "drift",
  "degraded",
  "unverified",
  "pending",
  "running",
  "queued",
  "building",
  "provisioning",
];
const CRIT = ["error", "failed", "incident", "crit", "critical"];

/**
 * Status words that must be matched whole. `up` is why this table exists:
 * the substring pass below would also fire it on "supabase", "backup" and
 * "group". Everything here comes from a real producer — uptime statuses
 * (lib/api.ts UptimeNodeSummary), the briefing and activity tones
 * (lib/briefing.ts, lib/activity.ts), deployment statuses, and the alert
 * rules' on/off.
 */
const EXACT: Record<string, Tone> = {
  up: "ok",
  alive: "ok",
  healthy: "ok",
  on: "ok",
  down: "crit",
  unreachable: "crit",
  warning: "warn",
  neutral: "idle",
  unknown: "idle",
  cancelled: "idle",
  canceled: "idle",
  off: "idle",
  "rolled back": "idle",
};

export function toneFor(status: string): Tone {
  const s = status.toLowerCase().replace(/[_-]+/g, " ").trim();
  const exact = EXACT[s];
  if (exact) return exact;
  if (CRIT.some((k) => s.includes(k))) return "crit";
  if (WARN.some((k) => s.includes(k))) return "warn";
  if (OK.some((k) => s.includes(k))) return "ok";
  return "idle";
}

const dotClass: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  crit: "bg-crit",
  idle: "bg-dim",
};

const tagClass: Record<Tone, string> = {
  ok: "text-ok border-ok/30",
  warn: "text-warn border-warn/30",
  crit: "text-crit border-crit/30",
  idle: "text-muted-foreground border-border-soft",
};

export function StateDot({ tone }: { tone: Tone }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dotClass[tone]}`}
    />
  );
}

export function StateTag({
  tone,
  label,
  dot = false,
}: {
  tone: Tone;
  label: string;
  dot?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] lowercase ${tagClass[tone]}`}
    >
      {dot && <StateDot tone={tone} />}
      {label}
    </span>
  );
}
