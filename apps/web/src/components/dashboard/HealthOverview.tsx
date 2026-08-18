import type {
  Incident,
  StackDrift,
  UptimeNodeSummary,
  ObservabilityData,
} from "../../lib/api";
import { Rows, Row, Dim } from "../console/Rows";
import { StateDot, toneFor, type Tone } from "../console/StateTag";

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

const VERDICT: Record<HealthStatus, { tone: Tone; label: string }> = {
  healthy: { tone: "ok", label: "healthy" },
  degraded: { tone: "warn", label: "degraded" },
  down: { tone: "crit", label: "down" },
};

/**
 * Fourteen segments of recent uptime history.
 *
 * The API ships `sparkline` as `latency_ms ?? 0` per check
 * (workers/api/src/routes/uptime.ts:28) and drops the per-row `ok` boolean
 * on the way out, so a zero is read as a failed check: a check that
 * answered records a latency, one that did not records nothing. That is an
 * inference over real data, not a fabricated series. The exact fix is an
 * additive `checks: boolean[]` on UptimeNodeSummary — logged as a follow-up
 * rather than smuggled into a skin PR.
 */
function UptimeBar({ sparkline }: { sparkline: number[] }) {
  const seg = sparkline.slice(-14);
  const pad = Array.from({ length: Math.max(0, 14 - seg.length) });
  return (
    <span aria-hidden className="flex shrink-0 items-center gap-[2px]">
      {pad.map((_, i) => (
        <span key={`p${i}`} className="h-3 w-[3px] rounded-[1px] bg-border" />
      ))}
      {seg.map((v, i) => (
        <span
          key={i}
          className={`h-3 w-[3px] rounded-[1px] ${v > 0 ? "bg-ok" : "bg-crit"}`}
        />
      ))}
    </span>
  );
}

export type CanvasLike = {
  nodes?: Array<{ id: string; data?: { label?: string } }>;
} | null;

export function HealthOverview({
  incidents,
  drifts,
  uptime,
  observability,
  canvas,
}: {
  incidents: Incident[];
  drifts: StackDrift[];
  uptime: Record<string, UptimeNodeSummary>;
  observability: ObservabilityData | null;
  /** Only to resolve node ids to service names, as UptimePanel does. A row
   *  labelled `n3` is not a per-service row. */
  canvas?: CanvasLike;
}) {
  const nodeLabel = (id: string) =>
    canvas?.nodes?.find((n) => n.id === id)?.data?.label ?? id;
  const { status, reasons } = deriveHealth({
    incidents,
    drifts,
    uptime,
    observability,
  });
  const v = VERDICT[status];
  const entries = Object.entries(uptime);

  return (
    <div className="flex flex-col gap-3">
      {/* A verdict line, not a tinted container: washing the whole box in a
          state colour is the loudest thing on the page and D3 reserves hue
          for the marker, not the surface. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StateDot tone={v.tone} />
        <span className="font-mono text-[11px] lowercase tracking-wide">
          {v.label}
        </span>
        <span className="text-[13px] text-muted-foreground">
          {reasons.join(" · ")}
        </span>
      </div>

      {entries.length > 0 && (
        <Rows>
          {entries.map(([nodeId, u]) => (
            <Row key={nodeId}>
              <StateDot tone={toneFor(u.status)} />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                {nodeLabel(nodeId)}
              </span>
              <UptimeBar sparkline={u.sparkline} />
              {/* The percentage is where a threshold earns a tone. */}
              <span
                className={`w-16 shrink-0 text-right font-mono text-[11px] tabular-nums ${
                  u.uptime7d >= 99.9
                    ? "text-muted-foreground"
                    : u.uptime7d >= UPTIME_DEGRADED
                      ? "text-warn"
                      : "text-crit"
                }`}
              >
                {u.uptime7d.toFixed(2)}%
              </span>
              <Dim>
                {u.lastLatencyMs != null ? `${u.lastLatencyMs}ms` : "—"}
              </Dim>
            </Row>
          ))}
        </Rows>
      )}
    </div>
  );
}
