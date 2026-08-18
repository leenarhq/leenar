import type { ReactNode } from "react";
import { Cloud, Triangle, Database, Mail } from "lucide-react";
import type {
  ObservabilityData,
  ObservabilityHistory,
  MetricPoint,
} from "../../lib/api";
import { EmptyRow } from "./Panel";
import { TimeSeriesChart } from "./TimeSeriesChart";
import { HairGrid, HairCell } from "../console/HairGrid";

function formatMs(ms: number) {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

/** Extract a numeric metric series from persisted history points. */
function trend(
  points: MetricPoint[] | undefined,
  key: string,
  scale = 1,
): Array<{ x: string; y: number }> {
  return (points ?? [])
    .filter((p) => typeof p.metrics[key] === "number")
    .map((p) => ({
      x: p.capturedAt.slice(5, 16).replace("T", " "),
      y: (p.metrics[key] as number) * scale,
    }));
}

function ProviderCard({
  name,
  icon: Icon,
  rows,
  chart,
}: {
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  rows: ReactNode;
  chart?: ReactNode;
}) {
  return (
    <HairCell className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2 font-mono text-[10px] lowercase tracking-wide text-dim">
        <Icon className="h-3 w-3" />
        {name}
      </div>
      <div className="space-y-1.5">{rows}</div>
      {chart}
    </HairCell>
  );
}

/**
 * No `color` prop. An error-rate line drawn permanently in `crit` is colour
 * marking a metric, not a state — the threshold is what earns a tone, not
 * the series (spec D3). Every chart on this surface is ink.
 */
function ChartBlock({
  title,
  points,
  yFormat,
}: {
  title: string;
  points: Array<{ x: string; y: number }>;
  yFormat: (v: number) => string;
}) {
  return (
    <div className="mt-auto">
      <div className="mb-1 font-mono text-[10px] lowercase tracking-wide text-dim">
        {title}
      </div>
      {points.length >= 2 ? (
        <div className="text-dim">
          <TimeSeriesChart
            height={120}
            yFormat={yFormat}
            series={[{ label: title, color: "currentColor", points }]}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-border-soft py-6 text-center text-[11px] text-muted-foreground">
          Not enough history yet
        </div>
      )}
    </div>
  );
}

export function ObservabilityPanel({
  observability,
  history,
}: {
  observability: ObservabilityData | null;
  history?: ObservabilityHistory;
}) {
  const cf = observability?.cloudflare;
  const vc = observability?.vercel;
  const sb = observability?.supabase;
  // Resend has no live observability feed yet; render it only if the API
  // ever starts returning it (keeps the card set future-proof).
  const rs = (observability as { resend?: Record<string, unknown> } | null)
    ?.resend;
  const hasAny = cf || vc || sb || rs;

  if (!hasAny) {
    return (
      <div className="rounded-2xl border border-border">
        <EmptyRow>No observability data</EmptyRow>
      </div>
    );
  }

  return (
    <HairGrid cols={2}>
      {cf && (
        <ProviderCard
          name="Cloudflare"
          icon={Cloud}
          rows={
            <>
              <Row
                label="Requests 24h"
                value={cf.requests24h.toLocaleString()}
              />
              <Row
                label="Error rate"
                value={`${(cf.errorRate * 100).toFixed(1)}%`}
              />
              <Row label="CPU p50" value={formatMs(cf.cpuP50Ms)} />
              <Row label="CPU p99" value={formatMs(cf.cpuP99Ms)} />
            </>
          }
          chart={
            <ChartBlock
              title="Error rate trend (7d)"
              yFormat={(v) => `${v.toFixed(1)}%`}
              points={trend(history?.cloudflare, "errorRate", 100)}
            />
          }
        />
      )}

      {vc && (
        <ProviderCard
          name="Vercel"
          icon={Triangle}
          rows={
            <>
              <Row
                label="Success 7d"
                value={`${(vc.successRate7d * 100).toFixed(0)}%`}
              />
              <Row label="Deploys 7d" value={String(vc.totalDeploys7d)} />
              <Row label="Avg build" value={formatMs(vc.avgBuildMs)} />
            </>
          }
          chart={
            <ChartBlock
              title="Build success trend (7d)"
              yFormat={(v) => `${v.toFixed(0)}%`}
              points={trend(history?.vercel, "successRate7d", 100)}
            />
          }
        />
      )}

      {sb && (
        <ProviderCard
          name="Supabase"
          icon={Database}
          rows={
            <>
              <Row label="Status" value={sb.projectStatus} />
              <Row label="Region" value={sb.region} />
            </>
          }
        />
      )}

      {rs && (
        <ProviderCard
          name="Resend"
          icon={Mail}
          rows={
            <>
              {Object.entries(rs).map(([k, v]) => (
                <Row key={k} label={k} value={String(v)} />
              ))}
            </>
          }
        />
      )}
    </HairGrid>
  );
}
