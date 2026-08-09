import { Activity } from "lucide-react";
import type {
  Incident,
  StackDrift,
  UptimeNodeSummary,
  ObservabilityData,
} from "../../lib/api";
import { cn } from "../../lib/utils";

export type HealthStatus = "healthy" | "degraded" | "down";

export interface HealthResult {
  status: HealthStatus;
  reasons: string[];
}

// Error-rate threshold (fraction) above which Cloudflare traffic is considered degraded.
const ERROR_RATE_DEGRADED = 0.02;
// Uptime percentage below which a node is considered degraded.
const UPTIME_DEGRADED = 99;

/**
 * Collapse the independent dashboard signals into a single at-a-glance verdict.
 * `down` beats `degraded` beats `healthy`. Derived entirely client-side from data the
 * dashboard already fetches — no extra backend call.
 */
export function deriveHealth(input: {
  incidents: Incident[];
  drifts: StackDrift[];
  uptime: Record<string, UptimeNodeSummary>;
  observability: ObservabilityData | null;
}): HealthResult {
  const { incidents, drifts, uptime, observability } = input;
  const reasons: string[] = [];
  let status: HealthStatus = "healthy";

  const openIncidents = incidents.filter((i) => i.status === "open");
  const downNodes = Object.entries(uptime).filter(
    ([, u]) => u.status === "down",
  );

  if (downNodes.length > 0) {
    status = "down";
    reasons.push(
      `${downNodes.length} service${downNodes.length > 1 ? "s" : ""} unreachable`,
    );
  }
  if (openIncidents.length > 0) {
    // An open incident is at least degraded; a 5xx/error incident escalates to down.
    const severe = openIncidents.some(
      (i) => i.severity === "5xx" || i.severity === "error",
    );
    if (severe) status = "down";
    else if (status !== "down") status = "degraded";
    reasons.push(
      `${openIncidents.length} open incident${openIncidents.length > 1 ? "s" : ""}`,
    );
  }

  const lowUptime = Object.entries(uptime).filter(
    ([, u]) => u.status !== "down" && u.uptime7d < UPTIME_DEGRADED,
  );
  if (lowUptime.length > 0) {
    if (status === "healthy") status = "degraded";
    reasons.push(
      `${lowUptime.length} service below ${UPTIME_DEGRADED}% uptime`,
    );
  }

  if (drifts.length > 0) {
    if (status === "healthy") status = "degraded";
    reasons.push(
      `${drifts.length} infrastructure drift${drifts.length > 1 ? "s" : ""}`,
    );
  }

  const errorRate = observability?.cloudflare?.errorRate;
  if (errorRate != null && errorRate > ERROR_RATE_DEGRADED) {
    if (status === "healthy") status = "degraded";
    reasons.push(`Error rate ${(errorRate * 100).toFixed(1)}%`);
  }

  if (reasons.length === 0) reasons.push("All systems operational");
  return { status, reasons };
}

const STYLES: Record<
  HealthStatus,
  { dot: string; ring: string; label: string }
> = {
  healthy: {
    dot: "bg-emerald-500",
    ring: "border-emerald-500/40 bg-emerald-500/5",
    label: "Healthy",
  },
  degraded: {
    dot: "bg-yellow-500",
    ring: "border-yellow-500/40 bg-yellow-500/5",
    label: "Degraded",
  },
  down: {
    dot: "bg-destructive",
    ring: "border-destructive/40 bg-destructive/10",
    label: "Down",
  },
};

export function HealthOverview({
  incidents,
  drifts,
  uptime,
  observability,
}: {
  incidents: Incident[];
  drifts: StackDrift[];
  uptime: Record<string, UptimeNodeSummary>;
  observability: ObservabilityData | null;
}) {
  const { status, reasons } = deriveHealth({
    incidents,
    drifts,
    uptime,
    observability,
  });
  const s = STYLES[status];

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border px-4 py-3",
        s.ring,
      )}
    >
      <span className="inline-flex items-center gap-2">
        <Activity className="h-3.5 w-3.5 text-muted-foreground" />
        <span className={cn("inline-block h-2 w-2 rounded-full", s.dot)} />
        <span className="font-mono text-xs font-semibold uppercase tracking-wider">
          {s.label}
        </span>
      </span>
      <span className="text-xs text-muted-foreground">
        {reasons.join(" · ")}
      </span>
    </div>
  );
}
