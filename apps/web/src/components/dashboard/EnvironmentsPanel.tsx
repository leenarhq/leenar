import { Layers } from "lucide-react";
import type { WorkflowEnvironment } from "../../lib/api";
import { Panel, EmptyRow } from "./Panel";

export function EnvironmentsPanel({
  environments,
}: {
  environments: WorkflowEnvironment[];
  projectId: string;
}) {
  return (
    <Panel title="Environments" icon={Layers} bodyClassName="p-0">
      {environments.length === 0 ? (
        <EmptyRow>No environments configured</EmptyRow>
      ) : (
        <div className="divide-y divide-border">
          {[...environments]
            .sort((a, b) => a.display_order - b.display_order)
            .map((env) => (
              <div
                key={env.id}
                className="flex items-center justify-between px-4 py-2.5 text-xs"
              >
                <span className="inline-flex items-center gap-2">
                  <span className="font-mono">{env.name}</span>
                  <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                    {env.slug}
                  </span>
                </span>
                {env.is_default && (
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] text-muted-foreground">
                    DEFAULT
                  </span>
                )}
              </div>
            ))}
        </div>
      )}
    </Panel>
  );
}
