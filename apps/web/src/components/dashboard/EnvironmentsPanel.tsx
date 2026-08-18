import { Layers } from "lucide-react";
import type { WorkflowEnvironment } from "../../lib/api";
import { Panel, EmptyRow } from "./Panel";
import { Row, Mono } from "../console/Rows";

export function EnvironmentsPanel({
  environments,
}: {
  environments: WorkflowEnvironment[];
}) {
  return (
    <Panel title="Environments" icon={Layers} bodyClassName="p-0">
      {environments.length === 0 ? (
        <EmptyRow>No environments configured</EmptyRow>
      ) : (
        <div>
          {[...environments]
            .sort((a, b) => a.display_order - b.display_order)
            .map((env) => (
              <Row key={env.id}>
                <span className="font-mono text-[13px]">{env.name}</span>
                <Mono>{env.slug}</Mono>
                {env.is_default && (
                  <span className="ml-auto rounded-full border border-border-soft px-2 py-0.5 font-mono text-[10px] lowercase text-dim">
                    default
                  </span>
                )}
              </Row>
            ))}
        </div>
      )}
    </Panel>
  );
}
