import { useId, useState } from "react";

export interface Series {
  label: string;
  /**
   * A CSS colour. Pass `"currentColor"` and let the wrapper's text colour
   * carry it — the console's charts are a single ink ramp, and a hue here
   * is only correct when it marks a threshold (spec D3).
   */
  color: string;
  points: Array<{ x: string; y: number }>;
}

/**
 * Dependency-free SVG time-series chart. Renders one or more line series over a shared
 * X domain (categorical, index-based) with a light Y axis and a hover tooltip. Sized to
 * its container via viewBox + preserveAspectRatio, so it scales responsively.
 */
export function TimeSeriesChart({
  series,
  height = 120,
  yFormat = (v) => v.toFixed(2),
  projection,
}: {
  series: Series[];
  height?: number;
  yFormat?: (v: number) => string;
  /** Optional dashed horizontal reference line (e.g. month-end cost projection). */
  projection?: { value: number; color: string; label: string };
}) {
  const clipId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const W = 320;
  const H = height;
  const padL = 36;
  const padR = 8;
  const padT = 8;
  const padB = 18;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const maxLen = Math.max(0, ...series.map((s) => s.points.length));
  if (maxLen < 2) {
    return (
      <div className="py-8 text-center text-[13px] text-muted-foreground">
        Not enough data yet
      </div>
    );
  }

  const allY = series.flatMap((s) => s.points.map((p) => p.y));
  if (projection) allY.push(projection.value);
  const maxY = Math.max(1, ...allY);
  const minY = Math.min(0, ...allY);
  const spanY = maxY - minY || 1;

  const xAt = (i: number) => padL + (i / (maxLen - 1)) * plotW;
  const yAt = (v: number) => padT + plotH - ((v - minY) / spanY) * plotH;

  const yTicks = [minY, minY + spanY / 2, maxY];

  // X labels from the longest series (first, middle, last).
  const longest = series.reduce((a, b) =>
    b.points.length > a.points.length ? b : a,
  );
  const xLabelIdx = [0, Math.floor((maxLen - 1) / 2), maxLen - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      preserveAspectRatio="none"
      onMouseLeave={() => setHover(null)}
      onMouseMove={(e) => {
        const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const relX = ((e.clientX - rect.left) / rect.width) * W;
        const i = Math.round(((relX - padL) / plotW) * (maxLen - 1));
        setHover(Math.max(0, Math.min(maxLen - 1, i)));
      }}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={padL} y={padT} width={plotW} height={plotH} />
        </clipPath>
      </defs>

      {/* Y grid + labels */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line
            x1={padL}
            x2={W - padR}
            y1={yAt(t)}
            y2={yAt(t)}
            className="stroke-border"
            strokeWidth={0.5}
          />
          <text
            x={padL - 4}
            y={yAt(t) + 3}
            textAnchor="end"
            className="fill-muted-foreground"
            fontSize={8}
          >
            {yFormat(t)}
          </text>
        </g>
      ))}

      {/* Projection reference line */}
      {projection && (
        <line
          x1={padL}
          x2={W - padR}
          y1={yAt(projection.value)}
          y2={yAt(projection.value)}
          stroke={projection.color}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      )}

      {/* Series lines */}
      <g clipPath={`url(#${clipId})`}>
        {series.map((s) => {
          const pts = s.points.map((p, i) => `${xAt(i)},${yAt(p.y)}`).join(" ");
          const area = `${padL},${padT + plotH} ${pts} ${xAt(s.points.length - 1)},${padT + plotH}`;
          return (
            <g key={s.label}>
              <polygon points={area} fill={s.color} fillOpacity={0.08} />
              <polyline
                points={pts}
                fill="none"
                stroke={s.color}
                strokeWidth={1.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}
      </g>

      {/* X labels */}
      {xLabelIdx.map((i) => (
        <text
          key={i}
          x={xAt(i)}
          y={H - 4}
          textAnchor={i === 0 ? "start" : i === maxLen - 1 ? "end" : "middle"}
          className="fill-muted-foreground"
          fontSize={8}
        >
          {longest.points[i]?.x ?? ""}
        </text>
      ))}

      {/* Hover marker + tooltip */}
      {hover != null && (
        <g>
          <line
            x1={xAt(hover)}
            x2={xAt(hover)}
            y1={padT}
            y2={padT + plotH}
            className="stroke-border"
            strokeWidth={0.75}
          />
          {series.map((s) => {
            const p = s.points[hover];
            if (!p) return null;
            return (
              <circle
                key={s.label}
                cx={xAt(hover)}
                cy={yAt(p.y)}
                r={2}
                fill={s.color}
              />
            );
          })}
          <text
            x={xAt(hover)}
            y={padT + 8}
            textAnchor={hover > maxLen / 2 ? "end" : "start"}
            className="fill-foreground"
            fontSize={8}
          >
            {series
              .map((s) => (s.points[hover] ? yFormat(s.points[hover].y) : ""))
              .filter(Boolean)
              .join("  ")}
          </text>
        </g>
      )}
    </svg>
  );
}
