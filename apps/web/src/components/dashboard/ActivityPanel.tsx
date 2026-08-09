import { Activity } from "lucide-react";
import type { ActivityItem } from "../../lib/activity";
import { timeAgo } from "../../lib/utils";
import { Panel, EmptyRow, StatusDot } from "./Panel";

export function ActivityPanel({ items }: { items: ActivityItem[] }) {
  return (
    <Panel title="Activity" icon={Activity}>
      {items.length === 0 ? (
        <EmptyRow>No recent activity</EmptyRow>
      ) : (
        <ul className="space-y-2.5">
          {items.slice(0, 8).map((it) => (
            <li key={it.id} className="flex items-center gap-2.5 text-xs">
              <StatusDot tone={it.tone} />
              <span className="flex-1 truncate">{it.label}</span>
              <span className="whitespace-nowrap text-muted-foreground">
                {timeAgo(new Date(it.ts).getTime())}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
