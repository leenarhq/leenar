import { useCallback } from "react";
import type React from "react";
import type { Node, Edge, Viewport } from "@xyflow/react";
import { toast } from "sonner";

interface UseCanvasImportExportOptions {
  toObject: () => { nodes: Node[]; edges: Edge[]; viewport?: Viewport };
  workflowNameRef: React.MutableRefObject<string>;
  setWorkflowName: (name: string) => void;
  setSaveState: (s: "saved" | "saving" | "unsaved") => void;
  takeSnapshot: () => void;
  setNodesFlow: (nodes: Node[]) => void;
  setEdgesFlow: (edges: Edge[]) => void;
  setViewport: (vp: Viewport) => void;
}

export function useCanvasImportExport({
  toObject,
  workflowNameRef,
  setWorkflowName,
  setSaveState,
  takeSnapshot,
  setNodesFlow,
  setEdgesFlow,
  setViewport,
}: UseCanvasImportExportOptions) {
  const handleExport = useCallback(() => {
    const canvas = toObject();
    const data = {
      name: workflowNameRef.current,
      exportedAt: new Date().toISOString(),
      canvas,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${workflowNameRef.current.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}-leenar.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [toObject, workflowNameRef]);

  const handleCanvasImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        const canvas = json.canvas ?? json;
        const { nodes: n, edges: ed, viewport: vp } = canvas;
        if (!Array.isArray(n)) throw new Error("Invalid format");
        takeSnapshot();
        setNodesFlow(n);
        setEdgesFlow(ed ?? []);
        if (vp) setViewport(vp);
        if (json.name) {
          workflowNameRef.current = json.name;
          setWorkflowName(json.name);
        }
        setSaveState("unsaved");
        toast.info(
          "Canvas imported — click Deploy to provision these services",
          { duration: 6000 },
        );
      } catch {
        toast.error("Import failed — check the JSON format");
      }
    },
    [
      takeSnapshot,
      setNodesFlow,
      setEdgesFlow,
      setViewport,
      workflowNameRef,
      setWorkflowName,
      setSaveState,
    ],
  );

  return { handleExport, handleCanvasImport };
}
