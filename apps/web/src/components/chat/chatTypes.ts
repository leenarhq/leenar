import type { CanvasUpdatePayload } from "../../lib/api";

/**
 * The shapes the chat passes between its own pieces.
 *
 * `SimpleNode`/`SimpleEdge` are deliberately not ReactFlow's `Node`/`Edge`:
 * the chat reads a canvas, it does not render one, and taking the full type
 * would tie this directory to @xyflow. The mobile sheet casts into these,
 * which is only sound because they are a subset.
 */
export interface SimpleNode {
  id: string;
  type: string;
  data?: {
    label?: string;
    provider?: string;
    status?: string;
    provisionedUrl?: string;
    existing_repo?: string;
    [key: string]: unknown;
  };
}

export interface SimpleEdge {
  id: string;
  source: string;
  target: string;
  data?: { envVars?: string[]; synced?: boolean };
}

/**
 * A message after the transport shape has been unpacked.
 *
 * `autoApplied` is persisted, not derived: it records whether the canvas took
 * the update at the moment it arrived, which depends on where the chat was
 * open. See CanvasUpdateCard for what the three combinations mean.
 */
export interface ParsedMessage {
  role: "user" | "assistant";
  content: string;
  canvasUpdate?: CanvasUpdatePayload;
  autoApplied?: boolean;
  pendingUpdate?: CanvasUpdatePayload;
}

export interface LogEntry {
  time: string;
  source: string;
  msg: string;
  type: "info" | "success" | "error" | "warning";
}

export interface ChatPanelProps {
  nodes?: SimpleNode[];
  edges?: SimpleEdge[];
  /** Absent when the surface hosting the chat has no canvas to write to —
   *  the mobile sheet. Everything downstream keys off that absence. */
  onAddNodes?: (update: CanvasUpdatePayload) => void;
  workflowId?: string;
  workflowName?: string;
  initialMessages?: Array<{ role: "user" | "assistant"; content: string }>;
  onDeploy?: () => void;
  onApplyTemplate?: (templateName: string) => void;
  isDeploying?: boolean;
  deployLogs?: LogEntry[];
  className?: string;
  currentEnvName?: string;
  currentEnvIsDefault?: boolean;
  environments?: Array<{ name: string; slug: string; is_default: boolean }>;
}
