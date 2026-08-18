import { Activity } from "lucide-react";
import type { ActivityItem } from "../../lib/activity";
import { timeAgo } from "../../lib/utils";
import { Panel, EmptyRow } from "./Panel";
import { Row, Dim } from "../console/Rows";
import { StateDot, toneFor } from "../console/StateTag";

export function ActivityPanel({ items }: { items: ActivityItem[] }) {
  return (
    <Panel title="Activity" icon={Activity} bodyClassName="p-0">
      {items.length === 0 ? (
        <EmptyRow>No recent activity</EmptyRow>
      ) : (
        <div>
          {items.slice(0, 8).map((it) => (
            <Row key={it.id}>
              <StateDot tone={toneFor(it.tone)} />
              <span className="flex-1 truncate">{it.label}</span>
              <Dim>{timeAgo(new Date(it.ts).getTime())}</Dim>
            </Row>
          ))}
        </div>
      )}
    </Panel>
  );
}
