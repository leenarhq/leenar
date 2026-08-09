import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { useAuth } from "../../context/auth";
import { setDatabaseTables } from "../../lib/api";
import { TableEditor, type TableDef } from "./TableEditor";
import { Button } from "../ui/button";

type DraftSeedEditorProps = {
  projectId: string;
  nodeId: string;
  initialTables: TableDef[];
  onSaved?: () => void;
};

// Draft (unprovisioned) Supabase node: edits the canvas seed (node.data.tables)
// via a whole-array PUT. No live database exists yet, so this renders ONLY the
// seed editor — no SQL Editor tab, no live TableList. See task-2.6b-brief.md.
export function DraftSeedEditor({
  projectId,
  nodeId,
  initialTables,
  onSaved,
}: DraftSeedEditorProps) {
  const { session } = useAuth();
  const [tables, setTables] = useState<TableDef[]>(initialTables);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = JSON.stringify(tables) !== JSON.stringify(initialTables);

  const save = useMutation({
    mutationFn: () => setDatabaseTables(session!, projectId, nodeId, tables),
    onSuccess: () => {
      setJustSaved(true);
      onSaved?.();
      setTimeout(() => setJustSaved(false), 2000);
    },
  });

  const handleSave = () => {
    if (!session || !dirty || save.isPending) return;
    setJustSaved(false);
    save.mutate();
  };

  const errorMessage = (() => {
    if (!save.isError) return null;
    const msg =
      save.error instanceof Error ? save.error.message : "Failed to save.";
    if (msg.startsWith("canvas_conflict")) {
      return "The canvas changed since you loaded this page. Refresh and try again.";
    }
    return msg;
  })();

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        This database hasn&apos;t been provisioned yet. Define the seed tables
        below — they&apos;ll be created when you deploy from the canvas.
      </p>

      <TableEditor tables={tables} onChange={setTables} />

      {errorMessage && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle size={14} className="shrink-0" />
          {errorMessage}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!dirty || save.isPending || !session}
        >
          {save.isPending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : null}
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        {!save.isPending && justSaved && !dirty && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
            <Check size={12} />
            Saved
          </span>
        )}
      </div>
    </div>
  );
}
