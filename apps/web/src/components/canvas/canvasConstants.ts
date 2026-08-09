import { TriggerNode } from "./nodes/TriggerNode";
import { ActionNode } from "./nodes/ActionNode";
import { LogicNode } from "./nodes/LogicNode";
import { DepartmentNode } from "./nodes/DepartmentNode";
import { BlueprintEdge } from "./BlueprintEdge";

export const nodeTypes = {
  trigger: TriggerNode,
  service: ActionNode,
  logic: LogicNode,
  department: DepartmentNode,
};

export const edgeTypes = {
  blueprint: BlueprintEdge,
};
