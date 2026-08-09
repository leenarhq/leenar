import { useEffect } from "react";
import type { Node } from "@xyflow/react";

interface UseNodeMenuDispatcherParams {
  nodes: Node[];
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setSelectedNode: React.Dispatch<React.SetStateAction<Node | null>>;
  setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setDeletionTarget: React.Dispatch<React.SetStateAction<Node | null>>;
  takeSnapshot: () => void;
}

export function useNodeMenuDispatcher({
  nodes,
  setNodes,
  setSelectedNode,
  setIsSidebarOpen,
  setDeletionTarget,
  takeSnapshot,
}: UseNodeMenuDispatcherParams) {
  useEffect(() => {
    const handler = (e: Event) => {
      const { nodeId, action } = (e as CustomEvent).detail as {
        nodeId: string;
        action: "settings" | "delete" | "duplicate";
      };
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      if (action === "settings") {
        setSelectedNode(node);
        setIsSidebarOpen(true);
      } else if (action === "delete") {
        setDeletionTarget(node);
      } else if (action === "duplicate") {
        takeSnapshot();
        const newId = `${node.type ?? "node"}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const {
          status: _s,
          provisionedAt: _pa,
          provisionedUrl: _pu,
          stackId: _si,
          errorMsg: _em,
          ...cleanData
        } = (node.data ?? {}) as Record<string, unknown>;
        setNodes((nds: Node[]) => [
          ...nds.map((n) => ({ ...n, selected: false })),
          {
            ...node,
            id: newId,
            position: { x: node.position.x + 40, y: node.position.y + 40 },
            selected: true,
            data: cleanData,
          },
        ]);
      }
    };
    window.addEventListener("leenar:node-menu", handler);
    return () => window.removeEventListener("leenar:node-menu", handler);
  }, [nodes]);
}
