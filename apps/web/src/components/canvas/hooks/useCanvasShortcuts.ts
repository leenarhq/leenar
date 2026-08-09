import { useEffect } from "react";
import type { Node } from "@xyflow/react";

interface UseCanvasShortcutsParams {
  undo: () => void;
  redo: () => void;
  fitView: (opts?: { duration?: number }) => void;
  selectedNodesArray: Node[];
  takeSnapshot: () => void;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  clipboardRef: React.MutableRefObject<Node[]>;
  pasteOffsetRef: React.MutableRefObject<number>;
  setShowShortcuts: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useCanvasShortcuts({
  undo,
  redo,
  fitView,
  selectedNodesArray,
  takeSnapshot,
  setNodes,
  clipboardRef,
  pasteOffsetRef,
  setShowShortcuts,
}: UseCanvasShortcutsParams) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const tag = (e.target as HTMLElement)?.tagName;
      const inInput =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (e.target as HTMLElement)?.isContentEditable;
      if (mod && e.key === "z" && !e.shiftKey && !inInput) {
        e.preventDefault();
        undo();
        return;
      }
      if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey)) && !inInput) {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.shiftKey && e.key === "f" && !inInput) {
        e.preventDefault();
        fitView({ duration: 500 });
        return;
      }
      if (mod && e.key === "c" && !inInput) {
        const sel = selectedNodesArray.filter((n) => n.type !== "department");
        if (sel.length > 0) {
          clipboardRef.current = sel;
          pasteOffsetRef.current = 0;
        }
        return;
      }
      if (mod && e.key === "v" && !inInput) {
        if (clipboardRef.current.length === 0) return;
        e.preventDefault();
        pasteOffsetRef.current += 24;
        const offset = pasteOffsetRef.current;
        takeSnapshot();
        const newNodes: Node[] = clipboardRef.current.map((n) => {
          const newId = `${n.type ?? "node"}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          // Strip provisioning state so the copy starts fresh
          const {
            status: _s,
            provisionedAt: _pa,
            provisionedUrl: _pu,
            stackId: _si,
            errorMsg: _em,
            ...cleanData
          } = n.data as Record<string, unknown>;
          return {
            ...n,
            id: newId,
            position: { x: n.position.x + offset, y: n.position.y + offset },
            selected: true,
            data: cleanData,
            parentId: undefined,
            extent: undefined,
          };
        });
        setNodes((nds: Node[]) => [
          ...nds.map((n) => ({ ...n, selected: false })),
          ...newNodes,
        ]);
        return;
      }
      if ((e.key === "?" || (mod && e.key === "/")) && !inInput) {
        e.preventDefault();
        setShowShortcuts((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, fitView, selectedNodesArray, takeSnapshot, setNodes]);
}
