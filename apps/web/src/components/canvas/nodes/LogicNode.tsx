import { Handle, Position } from "@xyflow/react";
import { GitBranch } from "lucide-react";
import { NodeShell, PORT_CLASS } from "./NodeShell";

export function LogicNode({ data, selected }: any) {
  const condition = data.config?.condition || data.condition || "";
  const yesLabel = data.config?.yesLabel || "true";
  const noLabel = data.config?.noLabel || "false";

  return (
    <div className="group relative">
      {/* Handle ids are load-bearing — `yes` and `no` are how a saved branch
          knows which way it went. Only the class changed. */}
      <Handle
        type="target"
        position={Position.Top}
        id="logic-t-top"
        className={PORT_CLASS}
        style={{ top: "-4px", left: "30%" }}
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="logic-t-bottom"
        className={PORT_CLASS}
        style={{ bottom: "-4px", left: "30%" }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="logic-t-left"
        className={PORT_CLASS}
        style={{ left: "-4px" }}
      />
      <Handle
        type="source"
        position={Position.Top}
        id="yes"
        className={PORT_CLASS}
        style={{ top: "-4px", left: "70%" }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="no"
        className={PORT_CLASS}
        style={{ bottom: "-4px", left: "70%" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="yes-r"
        className={PORT_CLASS}
        style={{ right: "-4px", top: "30%" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="no-r"
        className={PORT_CLASS}
        style={{ right: "-4px", top: "70%" }}
      />

      <NodeShell
        selected={selected}
        icon={<GitBranch className="h-[15px] w-[15px]" strokeWidth={1.4} />}
        label={data.label || "Decision Gate"}
        provider="condition"
      >
        <div className="mt-3 flex items-start gap-1.5 font-mono text-[10.5px]">
          <span className="shrink-0 text-dim">if</span>
          <span
            className={`truncate ${condition ? "text-muted-foreground" : "text-dim"}`}
          >
            {condition || "no condition set"}
          </span>
        </div>
        {/* The two branch labels. They used to be a green half and a red half
            of the footer — but a branch is not a success and a failure, it is
            two outcomes, so neither takes a tone. */}
        <div className="mt-2.5 flex items-center gap-4 border-t border-border-soft pt-2.5 font-mono text-[10px] text-muted-foreground">
          <span className="truncate">→ {yesLabel}</span>
          <span className="truncate">→ {noLabel}</span>
        </div>
      </NodeShell>
    </div>
  );
}
