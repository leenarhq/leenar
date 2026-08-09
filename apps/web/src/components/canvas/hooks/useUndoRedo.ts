import { useCallback, useRef, useState } from "react";
import type { Node, Edge } from "@xyflow/react";

const HISTORY_LIMIT = 30;

interface Snapshot {
  nodes: Node[];
  edges: Edge[];
}

interface UseUndoRedoResult {
  takeSnapshot: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  clearHistory: () => void;
}

/** History/future ring buffer for canvas undo/redo. Kept at 30 entries.
 *  Snapshots are deep-cloned via JSON to detach from current state. */
export function useUndoRedo(
  nodes: Node[],
  edges: Edge[],
  setNodesFlow: (nodes: Node[]) => void,
  setEdgesFlow: (edges: Edge[]) => void,
): UseUndoRedoResult {
  const historyRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const takeSnapshot = useCallback(() => {
    historyRef.current = [
      ...historyRef.current.slice(-(HISTORY_LIMIT - 1)),
      {
        nodes: JSON.parse(JSON.stringify(nodes)),
        edges: JSON.parse(JSON.stringify(edges)),
      },
    ];
    futureRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, [nodes, edges]);

  const undo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const previous = historyRef.current[historyRef.current.length - 1];
    futureRef.current = [
      {
        nodes: JSON.parse(JSON.stringify(nodes)),
        edges: JSON.parse(JSON.stringify(edges)),
      },
      ...futureRef.current,
    ];
    setNodesFlow(previous.nodes);
    setEdgesFlow(previous.edges);
    historyRef.current = historyRef.current.slice(0, -1);
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(true);
  }, [nodes, edges, setNodesFlow, setEdgesFlow]);

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const next = futureRef.current[0];
    historyRef.current = [
      ...historyRef.current,
      {
        nodes: JSON.parse(JSON.stringify(nodes)),
        edges: JSON.parse(JSON.stringify(edges)),
      },
    ];
    setNodesFlow(next.nodes);
    setEdgesFlow(next.edges);
    futureRef.current = futureRef.current.slice(1);
    setCanUndo(true);
    setCanRedo(futureRef.current.length > 0);
  }, [nodes, edges, setNodesFlow, setEdgesFlow]);

  const clearHistory = useCallback(() => {
    historyRef.current = [];
    futureRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  return { takeSnapshot, undo, redo, canUndo, canRedo, clearHistory };
}
