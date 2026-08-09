import type { ReactNode } from "react";
import { Cloud, Triangle, Database, Mail } from "lucide-react";
import type {
  ObservabilityData,
  ObservabilityHistory,
  MetricPoint,
} from "../../lib/api";
import { EmptyRow } from "./Panel";
import { TimeSeriesChart } from "./TimeSeriesChart";

function formatMs(ms: number) {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
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
    <div className="flex flex-col rounded-md border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {name}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="space-y-1.5">{rows}</div>
        {chart}
      </div>
    </div>
  );
}

function ChartBlock({
  title,
  points,
  color,
  yFormat,
}: {
  title: string;
  points: Array<{ x: string; y: number }>;
  color: string;
  yFormat: (v: number) => string;
}) {
  return (
    <div className="mt-auto">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {points.length >= 2 ? (
        <TimeSeriesChart
          height={120}
          yFormat={yFormat}
          series={[{ label: title, color, points }]}
        />
      ) : (
        <div className="rounded border border-dashed border-border py-6 text-center text-[11px] text-muted-foreground">
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
      <div className="rounded-md border border-border bg-card">
        <EmptyRow>No observability data</EmptyRow>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
              color="var(--destructive)"
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
              color="var(--primary)"
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
    </div>
  );
}
