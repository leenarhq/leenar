import { Sparkles } from "lucide-react";
import type { DashboardData } from "../../hooks/useProjectDashboard";
import { buildBriefing } from "../../lib/briefing";
import { StatusDot } from "./Panel";

export function DashboardBriefing({ data }: { data: DashboardData }) {
  const items = buildBriefing(data);
  if (items.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Sparkles className="h-3 w-3" /> Briefing
      </div>
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id} className="flex items-start gap-2.5 text-xs">
            <StatusDot tone={it.tone} className="mt-1" />
            <div>
              <span className="font-medium">{it.title}</span>{" "}
              <span className="text-muted-foreground">{it.detail}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
