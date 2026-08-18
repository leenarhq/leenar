import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Loader2,
  AlertCircle,
  Table2,
} from "lucide-react";
import { useAuth } from "../../context/auth";
import { getDatabaseSchema, mutateDatabaseSchema } from "../../lib/api";
import type { SchemaMutation, TableDef } from "../../lib/databaseTypes";
import { Button } from "../ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "../ui/alert-dialog";
import { TableEditor } from "./TableEditor";
import { NewTableButton } from "./tableEditControls";
import { RlsBadge, TableDetail, type PendingDestructive } from "./tableDetail";

type TableListProps = {
  projectId: string;
  nodeId: string;
};

const EMPTY_DRAFT: TableDef = { name: "", columns: [] };

export function TableList({ projectId, nodeId }: TableListProps) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [creatingTable, setCreatingTable] = useState(false);
  const [draft, setDraft] = useState<TableDef>(EMPTY_DRAFT);
  const [pendingDestructive, setPendingDestructive] =
    useState<PendingDestructive | null>(null);

  const schemaQuery = useQuery({
    queryKey: ["db-schema", projectId, nodeId],
    queryFn: () => getDatabaseSchema(session!, projectId, nodeId),
    enabled: !!session,
  });

  // Shared mutation helper — every capability funnels a single SchemaMutation
  // through here, then invalidates ["db-schema"] so the view refetches from
  // the live DB (source of truth). No optimistic local schema edits.
  const runMutation = useMutation({
    mutationFn: (m: SchemaMutation) =>
      mutateDatabaseSchema(session!, projectId, nodeId, m),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["db-schema", projectId, nodeId],
      });
    },
  });

  const toggleExpand = (tableName: string) => {
    setExpanded((prev) => (prev === tableName ? null : tableName));
  };

  const handleMutate = (m: SchemaMutation) => {
    runMutation.mutate(m);
  };

  const handleDropRequest = (target: PendingDestructive) => {
    setPendingDestructive(target);
  };

  const confirmDestructive = () => {
    if (!pendingDestructive) return;
    const { kind } = pendingDestructive;
    if (kind === "dropTable") {
      runMutation.mutate({
        kind: "dropTable",
        table: pendingDestructive.table,
      });
    } else if (kind === "dropColumn") {
      runMutation.mutate({
        kind: "dropColumn",
        table: pendingDestructive.table,
        column: pendingDestructive.column,
      });
    } else if (kind === "dropIndex") {
      runMutation.mutate({ kind: "dropIndex", name: pendingDestructive.name });
    }
    setPendingDestructive(null);
  };

  const destructiveDescription = (() => {
    if (!pendingDestructive) return "";
    if (pendingDestructive.kind === "dropTable") {
      return `Drop table "${pendingDestructive.table}"? This permanently deletes it and its data.`;
    }
    if (pendingDestructive.kind === "dropColumn") {
      return `Drop column "${pendingDestructive.column}" from "${pendingDestructive.table}"? This permanently deletes its data.`;
    }
    return `Drop index "${pendingDestructive.name}"? This cannot be undone.`;
  })();

  const openCreateTable = () => {
    setDraft(EMPTY_DRAFT);
    setCreatingTable(true);
  };

  const cancelCreateTable = () => {
    setCreatingTable(false);
    setDraft(EMPTY_DRAFT);
  };

  const submitCreateTable = () => {
    if (!draft.name.trim()) return;
    runMutation.mutate(
      { kind: "createTable", table: draft },
      {
        onSuccess: () => {
          setCreatingTable(false);
          setDraft(EMPTY_DRAFT);
        },
      },
    );
  };

  const tables = schemaQuery.data?.schema.tables ?? [];

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-foreground/70">
          {schemaQuery.isSuccess
            ? `${tables.length} table${tables.length === 1 ? "" : "s"}`
            : ""}
        </p>
        <div className="flex items-center gap-2">
          <NewTableButton
            disabled={runMutation.isPending || creatingTable}
            onClick={openCreateTable}
          />
          <button
            onClick={() =>
              queryClient.invalidateQueries({
                queryKey: ["db-schema", projectId, nodeId],
              })
            }
            disabled={schemaQuery.isFetching}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-secondary px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50"
          >
            {schemaQuery.isFetching ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            Refresh
          </button>
        </div>
      </div>

      {/* Mutation error banner */}
      {runMutation.isError && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle size={14} className="shrink-0" />
          {runMutation.error instanceof Error
            ? runMutation.error.message
            : "Mutation failed."}
        </div>
      )}

      {/* Create table form */}
      {creatingTable && (
        <div className="mb-4 rounded-xl border border-border bg-card p-3">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            New table
          </p>
          <TableEditor
            tables={[draft]}
            onChange={([t]) => setDraft(t ?? EMPTY_DRAFT)}
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={cancelCreateTable}
              disabled={runMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={submitCreateTable}
              disabled={runMutation.isPending || !draft.name.trim()}
            >
              {runMutation.isPending && (
                <Loader2 size={12} className="animate-spin" />
              )}
              Create
            </Button>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {schemaQuery.isLoading && (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-xl border border-border bg-secondary"
            />
          ))}
        </div>
      )}

      {/* Error state */}
      {schemaQuery.isError && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle size={14} className="shrink-0" />
          Failed to load schema
          {schemaQuery.error instanceof Error
            ? `: ${schemaQuery.error.message}`
            : "."}
        </div>
      )}

      {/* Empty state */}
      {schemaQuery.isSuccess && tables.length === 0 && (
        <div className="rounded-xl border border-border py-24 text-center text-sm text-muted-foreground">
          No tables found in this database.
        </div>
      )}

      {/* Table list */}
      {schemaQuery.isSuccess && tables.length > 0 && (
        <div className="space-y-2">
          {tables.map((table) => (
            <div
              key={table.name}
              className="rounded-xl border border-border bg-card overflow-hidden"
            >
              <button
                onClick={() => toggleExpand(table.name)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-secondary transition-colors"
              >
                <Table2 size={14} className="text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-foreground">
                      {table.name}
                    </span>
                    <RlsBadge enabled={table.rlsEnabled} />
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {table.columns.length} column
                    {table.columns.length === 1 ? "" : "s"} ·{" "}
                    {table.indexes.length} index
                    {table.indexes.length === 1 ? "" : "es"}
                  </div>
                </div>
                {expanded === table.name ? (
                  <ChevronUp
                    size={14}
                    className="text-muted-foreground shrink-0"
                  />
                ) : (
                  <ChevronDown
                    size={14}
                    className="text-muted-foreground shrink-0"
                  />
                )}
              </button>

              {expanded === table.name && (
                <TableDetail
                  table={table}
                  isPending={runMutation.isPending}
                  onMutate={handleMutate}
                  onDropRequest={handleDropRequest}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Destructive confirm dialog */}
      <AlertDialog
        open={pendingDestructive !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDestructive(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm destructive change</AlertDialogTitle>
            <AlertDialogDescription>
              {destructiveDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDestructive}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
