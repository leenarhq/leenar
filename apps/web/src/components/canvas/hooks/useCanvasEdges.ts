import { useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import {
  addEdge,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
} from "@xyflow/react";
import { ENV_FLOW, resolveEnvKeys } from "../../../lib/envFlow";
import { inferServiceType, nowTime } from "../workspaceHelpers";
import type { LogEntry } from "../../../lib/types";
import type { Session } from "@supabase/supabase-js";
import { deleteEdgeEnvVars } from "../../../lib/api";
import { normalizeHandles } from "../edgeDisplay";

interface UseCanvasEdgesParams {
  nodes: Node[];
  edges: Edge[];
  isRunning: boolean;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setDeployLogs: React.Dispatch<React.SetStateAction<LogEntry[]>>;
  takeSnapshot: () => void;
  onEdgesChange: (changes: any[]) => void;
  onUpdateNode: (id: string, data: any) => void;
  projectId?: string;
  session?: Session | null;
}

export function useCanvasEdges({
  nodes,
  edges,
  isRunning,
  setEdges,
  setNodes,
  setDeployLogs,
  takeSnapshot,
  onEdgesChange,
  onUpdateNode,
  projectId,
  session,
}: UseCanvasEdgesParams) {
  // Ref so onConnect always sees the latest nodes without stale closure issues
  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const onConnect = useCallback(
    (params: Connection) => {
      if (params.source === params.target) return;
      takeSnapshot();

      const currentNodes = nodesRef.current;
      const sourceNode = currentNodes.find((n) => n.id === params.source);
      const targetNode = currentNodes.find((n) => n.id === params.target);
      let envVars: string[] | undefined;
      let fromSvc: string | null = null;
      let toSvc: string | null = null;

      if (sourceNode?.type === "service" && targetNode?.type === "service") {
        fromSvc = inferServiceType(sourceNode.data as Record<string, unknown>);
        toSvc = inferServiceType(targetNode.data as Record<string, unknown>);
        if (fromSvc && toSvc) {
          const flowMap = ENV_FLOW[fromSvc];
          envVars = flowMap?.[toSvc]; // no default fallback
          if (!envVars?.length) {
            // Reverse direction: check if target provides env vars to source
            const revVars = ENV_FLOW[toSvc]?.[fromSvc]; // no default fallback
            if (revVars?.length) {
              envVars = revVars;
              // Swap so the log message reflects the actual injection direction
              [fromSvc, toSvc] = [toSvc, fromSvc];
            }
          }
        }
      }

      setEdges((eds: Edge[]) =>
        addEdge(
          {
            ...normalizeHandles(params),
            type: "blueprint",
            animated: isRunning,
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: envVars
                ? "#34d399"
                : getComputedStyle(document.documentElement)
                    .getPropertyValue("--app-accent")
                    .trim() || "#c8503a",
            },
            // Leave envVars empty: backend resolves ENV_FLOW + framework at
            // provision time. Freezing names here would be treated as a user
            // override that bypasses framework-aware prefix resolution.
            data: {},
          },
          eds,
        ),
      );

      // Resolve base names to the prefixed forms for display only (shotgun,
      // since the target framework is unknown until provisioning).
      const displayVars =
        envVars?.length && toSvc ? resolveEnvKeys(envVars, toSvc) : [];
      if (displayVars.length && fromSvc && toSvc) {
        const time = nowTime();
        setDeployLogs((prev) => [
          ...prev,
          {
            time,
            source: "canvas",
            msg: `↗ ${fromSvc} → ${toSvc}: ${displayVars.length} env ${displayVars.length === 1 ? "var" : "vars"} linked — ${displayVars.join(", ")}`,
            type: "info" as const,
          },
        ]);
        toast.success(`${fromSvc} → ${toSvc}`, {
          description: `${displayVars.length} env ${displayVars.length === 1 ? "var" : "vars"} will be injected on deploy:\n${displayVars.join("\n")}`,
          duration: 5000,
        });
      } else if (fromSvc && toSvc) {
        toast.info(`${fromSvc} → ${toSvc}`, {
          description:
            "No default env mapping. Click the edge to add custom env vars.",
          duration: 4000,
        });
      }
    },
    [setEdges, isRunning, takeSnapshot, nodes, setDeployLogs],
  );

  // Wrap onEdgesChange to clear node data when certain edges are removed
  const handleEdgesChange = useCallback(
    (changes: any[]) => {
      const removals = changes.filter((c) => c.type === "remove");
      if (removals.length > 0) {
        removals.forEach((change) => {
          const removedEdge = edges.find((e) => e.id === change.id);
          if (!removedEdge) return;
          const srcNode = nodes.find((n) => n.id === removedEdge.source);
          const tgtNode = nodes.find((n) => n.id === removedEdge.target);
          const srcProv = (srcNode?.data as any)?.provider;
          const tgtProv = (tgtNode?.data as any)?.provider;
          // GitHub→Vercel edge removed: clear repo selection on Vercel node
          if (srcProv === "github" && tgtProv === "vercel" && tgtNode) {
            setNodes((nds: Node[]) =>
              nds.map((n: Node) =>
                n.id === tgtNode.id
                  ? { ...n, data: { ...n.data, existing_repo: "" } }
                  : n,
              ),
            );
            onUpdateNode(tgtNode.id, { existing_repo: "" });
          }
          // Resend↔Supabase edge removed: clear email sender config on Supabase node
          const sbNode =
            srcProv === "resend" && tgtProv === "supabase"
              ? tgtNode
              : srcProv === "supabase" && tgtProv === "resend"
                ? srcNode
                : null;
          if (sbNode) {
            setNodes((nds: Node[]) =>
              nds.map((n: Node) =>
                n.id === sbNode.id
                  ? { ...n, data: { ...n.data, fromEmail: "", senderName: "" } }
                  : n,
              ),
            );
            onUpdateNode(sbNode.id, { fromEmail: "", senderName: "" });
          }

          // Synced edge with env vars removed: clean up injected vars from Vercel
          const edgeEnvVars = (removedEdge.data as any)?.envVars as
            | string[]
            | undefined;
          const wasSynced = (removedEdge.data as any)?.synced === true;
          if (
            wasSynced &&
            edgeEnvVars?.length &&
            tgtProv === "vercel" &&
            projectId &&
            session
          ) {
            const vercelProjectId = (tgtNode?.data as any)?.vercelProjectId as
              | string
              | undefined;
            if (vercelProjectId) {
              deleteEdgeEnvVars(
                projectId,
                vercelProjectId,
                edgeEnvVars,
                session,
              ).then(
                () =>
                  toast.info("Env vars removed from Vercel", {
                    description: `Removed: ${edgeEnvVars.join(", ")}`,
                    duration: 5000,
                  }),
                () =>
                  toast.error("Failed to remove env vars from Vercel", {
                    description: `Please remove manually: ${edgeEnvVars.join(", ")}`,
                    duration: 8000,
                  }),
              );
            }
          }
        });
      }
      onEdgesChange(changes);
    },
    [edges, nodes, onEdgesChange, setNodes, onUpdateNode, projectId, session],
  );

  return { onConnect, handleEdgesChange };
}
