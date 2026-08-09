import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Node, InternalNode, XYPosition } from "@xyflow/react";

interface UseNodeGroupingOptions {
  selectedNodesArray: Node[];
  setSelectedNodesArray: Dispatch<SetStateAction<Node[]>>;
  setNodes: Dispatch<SetStateAction<Node[]>>;
  takeSnapshot: () => void;
  menu: { x: number; y: number } | null;
  setMenu: (m: { x: number; y: number } | null) => void;
  screenToFlowPosition: (p: { x: number; y: number }) => XYPosition;
  getInternalNode: (id: string) => InternalNode | undefined;
}

/** Group selected nodes into a department (or create empty group),
 *  and re-parent dragged nodes when they're dropped on/off a group. */
export function useNodeGrouping({
  selectedNodesArray,
  setSelectedNodesArray,
  setNodes,
  takeSnapshot,
  menu,
  setMenu,
  screenToFlowPosition,
  getInternalNode,
}: UseNodeGroupingOptions) {
  const handleGroupNodes = useCallback(
    (type: "department" | "group" = "department") => {
      takeSnapshot();
      const id = `${type}-${Date.now()}`;
      if (selectedNodesArray.length > 0) {
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        selectedNodesArray.forEach((n) => {
          if (n.position.x < minX) minX = n.position.x;
          if (n.position.y < minY) minY = n.position.y;
          if (n.position.x + 240 > maxX) maxX = n.position.x + 240;
          if (n.position.y + 140 > maxY) maxY = n.position.y + 140;
        });
        const pad = 60;
        const newGroup: Node = {
          id,
          type: "department",
          position: { x: minX - pad, y: minY - pad * 1.5 },
          data: {
            label: `New ${type}`,
            childCount: selectedNodesArray.length,
            isLocked: false,
          },
          style: {
            width: maxX - minX + pad * 2,
            height: maxY - minY + pad * 2.5,
          },
        };
        setNodes((nds: Node[]) => {
          const updated = nds.map((n: Node) => {
            if (selectedNodesArray.find((sn) => sn.id === n.id)) {
              return {
                ...n,
                parentId: id,
                extent: "parent" as const,
                position: {
                  x: n.position.x - (minX - pad),
                  y: n.position.y - (minY - pad * 1.5),
                },
                selected: false,
              };
            }
            return n;
          });
          return [newGroup, ...updated];
        });
      } else {
        const position = menu
          ? screenToFlowPosition({ x: menu.x, y: menu.y })
          : screenToFlowPosition({
              x: window.innerWidth / 2,
              y: window.innerHeight / 2,
            });
        const newGroup: Node = {
          id,
          type: "department",
          position,
          data: { label: `Empty ${type}`, childCount: 0, isLocked: false },
          style: { width: 500, height: 350 },
        };
        setNodes((nds: Node[]) => [...nds, newGroup]);
      }
      setMenu(null);
      setSelectedNodesArray([]);
    },
    [
      selectedNodesArray,
      setNodes,
      takeSnapshot,
      menu,
      screenToFlowPosition,
      setMenu,
      setSelectedNodesArray,
    ],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, draggedNode: Node) => {
      if (draggedNode.type === "department") {
        takeSnapshot();
        return;
      }
      const internalNode = getInternalNode(draggedNode.id);
      if (!internalNode) return;
      const absPos = internalNode.internals.positionAbsolute;
      setNodes((nds: Node[]) => {
        let newParentId: string | undefined;
        let targetParentNode: Node | undefined;
        nds.forEach((n) => {
          if (n.type === "department" && n.id !== draggedNode.id) {
            const inside =
              absPos.x > n.position.x &&
              absPos.x < n.position.x + (n.measured?.width || 0) &&
              absPos.y > n.position.y &&
              absPos.y < n.position.y + (n.measured?.height || 0);
            if (inside) {
              newParentId = n.id;
              targetParentNode = n;
            }
          }
        });
        if (newParentId && draggedNode.parentId !== newParentId) {
          takeSnapshot();
          return nds.map((n: Node) =>
            n.id === draggedNode.id
              ? {
                  ...n,
                  parentId: newParentId,
                  extent: "parent" as const,
                  position: {
                    x: absPos.x - targetParentNode!.position.x,
                    y: absPos.y - targetParentNode!.position.y,
                  },
                }
              : n,
          );
        }
        if (!newParentId && draggedNode.parentId) {
          takeSnapshot();
          return nds.map((n: Node) =>
            n.id === draggedNode.id
              ? {
                  ...n,
                  parentId: undefined,
                  extent: undefined,
                  position: absPos,
                }
              : n,
          );
        }
        takeSnapshot();
        return nds;
      });
    },
    [setNodes, takeSnapshot, getInternalNode],
  );

  return { handleGroupNodes, onNodeDragStop };
}
