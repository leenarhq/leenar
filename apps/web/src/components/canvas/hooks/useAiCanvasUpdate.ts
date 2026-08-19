import { useCallback } from "react";
import { MarkerType, type Node, type Edge } from "@xyflow/react";
import type { CanvasUpdatePayload } from "../../../lib/api";
import { ENV_FLOW } from "../../../lib/envFlow";
import { inferServiceType, applyAutoLayout } from "../workspaceHelpers";

interface UseAiCanvasUpdateParams {
  nodes: Node[];
  isRunning: boolean;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  takeSnapshot: () => void;
  fitView: (opts?: { duration?: number; padding?: number }) => void;
}

export function useAiCanvasUpdate({
  nodes,
  isRunning,
  setNodes,
  setEdges,
  takeSnapshot,
  fitView,
}: UseAiCanvasUpdateParams) {
  const onAddNodes = useCallback(
    (update: CanvasUpdatePayload) => {
      takeSnapshot();
      const idPrefix = Date.now();

      const startX =
        nodes.length > 0
          ? Math.max(...nodes.map((n) => n.position.x)) + 320
          : 160;
      const startY =
        nodes.length > 0
          ? nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length
          : 220;

      const rawNewNodes: Node[] = (update.nodes ?? []).map((n, i) => ({
        id: `${n.type}-${idPrefix}-${i}`,
        type: n.type,
        position: { x: startX + i * 380, y: startY },
        data: n.data as any,
      }));

      // Resolve a source/target ref: number index → new node id, string → existing node id
      const allNodes = [...nodes, ...rawNewNodes];
      const resolveRef = (ref: number | string): Node | undefined =>
        typeof ref === "number"
          ? rawNewNodes[ref]
          : allNodes.find((n) => n.id === ref);

      const buildEdge = (srcNode: Node, tgtNode: Node, i: number): Edge => {
        const srcSvc = inferServiceType(
          srcNode.data as Record<string, unknown>,
        );
        const tgtSvc = inferServiceType(
          tgtNode.data as Record<string, unknown>,
        );
        const envVars =
          srcSvc && tgtSvc ? (ENV_FLOW[srcSvc]?.[tgtSvc] ?? []) : [];
        return {
          id: `ai-edge-${idPrefix}-${i}`,
          source: srcNode.id,
          target: tgtNode.id,
          type: "blueprint",
          sourceHandle: "source-right",
          targetHandle: "target-left",
          animated: isRunning,
          // No `color` — see BlueprintEdge: the arrowhead is derived.
          markerEnd: { type: MarkerType.ArrowClosed },
          // Leave data empty: backend resolves ENV_FLOW + framework at provision
          // time. Freezing names here would be treated as a user override.
          data: {},
        };
      };

      const newEdges: Edge[] = (update.edges ?? [])
        .map((e, i) => {
          const src = resolveRef(e.source);
          const tgt = resolveRef(e.target);
          if (!src || !tgt) return null;
          return buildEdge(src, tgt, i);
        })
        .filter(Boolean) as Edge[];

      // Layout only the new nodes using their own topology, then offset so they sit after existing nodes
      const laidNew = applyAutoLayout(rawNewNodes, newEdges);
      // applyAutoLayout starts at x=80 and centers vertically around y≈290
      const offsetX = startX - 80;
      const offsetY = startY - 290;
      const newNodes = laidNew.map((n) => ({
        ...n,
        position: { x: n.position.x + offsetX, y: n.position.y + offsetY },
      }));

      // Apply all node mutations in a single setNodes call to keep state consistent
      const hasNodeMutations =
        update.update?.length || update.remove?.length || newNodes.length > 0;
      if (hasNodeMutations) {
        const removeSet = new Set(update.remove ?? []);
        setNodes((nds: Node[]) => {
          let result = nds.map((n) => {
            const upd = update.update?.find((u) => u.id === n.id);
            return upd ? { ...n, data: { ...n.data, ...upd.data } } : n;
          });
          if (removeSet.size > 0)
            result = result.filter((n) => !removeSet.has(n.id));
          return newNodes.length > 0 ? [...result, ...newNodes] : result;
        });
      }

      // Apply all edge mutations in a single setEdges call
      const hasEdgeMutations =
        update.remove?.length ||
        update.disconnect?.length ||
        newEdges.length > 0;
      if (hasEdgeMutations) {
        const removeSet = new Set(update.remove ?? []);
        setEdges((eds: Edge[]) => {
          let result = eds.filter(
            (e) => !removeSet.has(e.source) && !removeSet.has(e.target),
          );
          if (update.disconnect?.length) {
            result = result.filter(
              (e) =>
                !update.disconnect!.some(
                  (d) =>
                    (d.from === e.source && d.to === e.target) ||
                    (d.from === e.target && d.to === e.source),
                ),
            );
          }
          return newEdges.length > 0 ? [...result, ...newEdges] : result;
        });
      }

      if (newNodes.length > 0)
        setTimeout(() => fitView({ duration: 600, padding: 0.2 }), 80);
    },
    [nodes, setNodes, setEdges, takeSnapshot, isRunning, fitView],
  );

  return { onAddNodes };
}
