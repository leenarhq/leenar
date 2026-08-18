import type { DashboardData } from "../../hooks/useProjectDashboard";
import { buildBriefing } from "../../lib/briefing";
import { StateDot, toneFor } from "../console/StateTag";

/**
 * The console's only display-face line (spec D4). Every other page header
 * is a plain 15px name in a PageBar; this one is a two-tone sentence
 * because the text is genuinely different on every load, which is the
 * whole argument D4 makes for why nothing else gets one.
 *
 * buildBriefing returns items in priority order. The first is the
 * sentence; the rest are a mono strip, so a project with four problems
 * still shows all four without four headings.
 *
 * The qualifier is `muted-foreground`, not `dim`: at 1.5rem the dim weight
 * is out of contract (DESIGN.md § 10 allows it only above 24px, and 1.5rem
 * is exactly 24px). Two tones, both readable.
 */
export function DashboardBriefing({ data }: { data: DashboardData }) {
  const items = buildBriefing(data);
  if (items.length === 0) return null;
  const [lead, ...rest] = items;

  return (
    <div className="pt-1">
      <p className="font-display flex items-baseline gap-2.5 text-[1.5rem] leading-[1.3] tracking-[-0.02em]">
        <span className="translate-y-[-0.35em]">
          <StateDot tone={toneFor(lead.tone)} />
        </span>
        <span className="min-w-0">
          {lead.title}{" "}
          <span className="text-muted-foreground">{lead.detail}</span>
        </span>
      </p>
      {rest.length > 0 && (
        <ul className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          {rest.map((it) => (
            <li key={it.id} className="flex items-center gap-2">
              <StateDot tone={toneFor(it.tone)} />
              <span className="font-mono text-[11px] lowercase text-muted-foreground">
                {it.title}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
