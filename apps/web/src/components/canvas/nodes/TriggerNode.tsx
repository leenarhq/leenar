import { Handle, Position } from "@xyflow/react";
import { Clock, Globe, Zap } from "lucide-react";
import { NodeShell, PORT_CLASS } from "./NodeShell";

export function TriggerNode({ data, selected }: any) {
  const isSchedule =
    data.subType === "schedule" || data.label?.toLowerCase().includes("timer");
  const isWebhook = data.subType === "webhook" || data.config?.url;
  const configText = isSchedule
    ? data.config?.schedule || ""
    : data.config?.url || "";

  const Icon = isSchedule ? Clock : isWebhook ? Globe : Zap;
  const typeLabel = isSchedule ? "Schedule" : isWebhook ? "Webhook" : "Trigger";

  return (
    <div className="group relative">
      {/* Handle ids are load-bearing — only the class changed. */}
      <Handle
        type="source"
        position={Position.Top}
        id="trig-s-top"
        className={PORT_CLASS}
        style={{ top: "-4px" }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="trig-s-bottom"
        className={PORT_CLASS}
        style={{ bottom: "-4px" }}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="trig-s-left"
        className={PORT_CLASS}
        style={{ left: "-4px" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="trig-s-right"
        className={PORT_CLASS}
        style={{ right: "-4px" }}
      />

      <NodeShell
        selected={selected}
        icon={<Icon className="h-[15px] w-[15px]" strokeWidth={1.4} />}
        label={data.label || typeLabel}
        // A trigger has no provider, so the slot carries its subtype — machine
        // text either way, and it belongs in mono.
        provider={String(data.subType ?? typeLabel).toLowerCase()}
        footLabel={configText ? undefined : "no config"}
      >
        {/* Not in the foot: the foot is lowercased, and a webhook URL or a
            cron expression is case-sensitive. */}
        {configText && (
          <p className="mt-3 truncate font-mono text-[10.5px] text-muted-foreground">
            {configText}
          </p>
        )}
      </NodeShell>
    </div>
  );
}
