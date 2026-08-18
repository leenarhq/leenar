import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "../../context/auth";
import {
  deleteTableRow,
  fetchTableRows,
  getDatabaseSchema,
  insertTableRow,
  updateTableRow,
} from "../../lib/api";
import type { LiveColumn, LiveTable } from "../../lib/databaseTypes";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "../ui/table";
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

type DataTabProps = {
  projectId: string;
  nodeId: string;
};

const PAGE_SIZE = 50;

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function DataTab({ projectId, nodeId }: DataTabProps) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [addingRow, setAddingRow] = useState(false);
  const [newRowValues, setNewRowValues] = useState<Record<string, string>>({});
  const [editingRowKey, setEditingRowKey] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<Record<
    string,
    unknown
  > | null>(null);

  const schemaQuery = useQuery({
    queryKey: ["db-schema", projectId, nodeId],
    queryFn: () => getDatabaseSchema(session!, projectId, nodeId),
    enabled: !!session,
  });

  const tables = useMemo(
    () => schemaQuery.data?.schema.tables ?? [],
    [schemaQuery.data],
  );

  const activeTable: LiveTable | null = useMemo(() => {
    if (!selectedTable) return null;
    return tables.find((t) => t.name === selectedTable) ?? null;
  }, [tables, selectedTable]);

  const pkColumns: LiveColumn[] = useMemo(
    () => activeTable?.columns.filter((c) => c.isPrimaryKey) ?? [],
    [activeTable],
  );
  const hasPk = pkColumns.length > 0;

  const selectTable = (name: string) => {
    setSelectedTable(name);
    setOffset(0);
    setAddingRow(false);
    setNewRowValues({});
    setEditingRowKey(null);
    setEditValues({});
  };

  const rowsQuery = useQuery({
    queryKey: ["db-rows", projectId, nodeId, selectedTable, offset],
    queryFn: () =>
      fetchTableRows(session!, projectId, nodeId, selectedTable!, {
        limit: PAGE_SIZE,
        offset,
      }),
    enabled: !!session && !!selectedTable,
  });

  const invalidateRows = () => {
    queryClient.invalidateQueries({
      queryKey: ["db-rows", projectId, nodeId, selectedTable],
    });
  };

  const insertMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      insertTableRow(session!, projectId, nodeId, selectedTable!, values),
    onSuccess: () => {
      invalidateRows();
      setAddingRow(false);
      setNewRowValues({});
    },
  });

  const updateMutation = useMutation({
    mutationFn: (vars: {
      pk: Record<string, unknown>;
      values: Record<string, unknown>;
    }) =>
      updateTableRow(
        session!,
        projectId,
        nodeId,
        selectedTable!,
        vars.pk,
        vars.values,
      ),
    onSuccess: () => {
      invalidateRows();
      setEditingRowKey(null);
      setEditValues({});
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (pk: Record<string, unknown>) =>
      deleteTableRow(session!, projectId, nodeId, selectedTable!, pk),
    onSuccess: () => {
      invalidateRows();
      setPendingDelete(null);
    },
  });

  const columns = rowsQuery.data?.columns ?? [];
  const rows = rowsQuery.data?.rows ?? [];

  const buildPk = (row: unknown[]): Record<string, unknown> => {
    const pk: Record<string, unknown> = {};
    for (const col of pkColumns) {
      const idx = columns.indexOf(col.name);
      if (idx !== -1) pk[col.name] = row[idx];
    }
    return pk;
  };

  const rowKey = (row: unknown[], i: number): string => {
    if (!hasPk) return String(i);
    const pk = buildPk(row);
    return JSON.stringify(pk);
  };

  const openAddRow = () => {
    setAddingRow(true);
    setNewRowValues({});
    insertMutation.reset();
  };

  const cancelAddRow = () => {
    setAddingRow(false);
    setNewRowValues({});
  };

  const submitAddRow = () => {
    const values: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(newRowValues)) {
      if (val.trim() !== "") values[key] = val;
    }
    insertMutation.mutate(values);
  };

  const startEdit = (row: unknown[], i: number) => {
    if (!hasPk) return;
    const values: Record<string, string> = {};
    columns.forEach((col, idx) => {
      const cell = row[idx];
      values[col] = cell === null || cell === undefined ? "" : String(cell);
    });
    setEditValues(values);
    setEditingRowKey(rowKey(row, i));
    updateMutation.reset();
  };

  const cancelEdit = () => {
    setEditingRowKey(null);
    setEditValues({});
  };

  const submitEdit = (row: unknown[]) => {
    const pk = buildPk(row);
    const pkNames = new Set(pkColumns.map((c) => c.name));
    const values: Record<string, unknown> = {};
    columns.forEach((col, idx) => {
      if (pkNames.has(col)) return;
      const original = row[idx];
      const originalStr =
        original === null || original === undefined ? "" : String(original);
      const edited = editValues[col] ?? "";
      if (edited !== originalStr) values[col] = edited;
    });
    updateMutation.mutate({ pk, values });
  };

  const requestDelete = (row: unknown[]) => {
    if (!hasPk) return;
    setPendingDelete(buildPk(row));
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    deleteMutation.mutate(pendingDelete);
  };

  const columnsForForm =
    columns.length > 0
      ? columns
      : (activeTable?.columns.map((c) => c.name) ?? []);

  return (
    <div>
      {/* Table picker */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Select
            value={selectedTable ?? undefined}
            onValueChange={(v) => selectTable(v)}
            disabled={schemaQuery.isLoading}
          >
            <SelectTrigger className="h-8 w-56 text-xs">
              <SelectValue placeholder="Select a table" />
            </SelectTrigger>
            <SelectContent>
              {tables.map((t) => (
                <SelectItem key={t.name} value={t.name} className="text-xs">
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {rowsQuery.isSuccess && (
            <p className="text-xs text-foreground/70">
              {rows.length} row{rows.length === 1 ? "" : "s"} shown
            </p>
          )}
        </div>

        {selectedTable && (
          <Button
            size="sm"
            onClick={openAddRow}
            disabled={addingRow || rowsQuery.isLoading}
          >
            <Plus size={12} />
            Add row
          </Button>
        )}
      </div>

      {/* No PK hint */}
      {activeTable && !hasPk && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-warn/20 bg-warn/10 px-4 py-3 text-sm text-warn">
          <AlertCircle size={14} className="shrink-0" />
          This table has no primary key — row editing and deleting is
          unavailable.
        </div>
      )}

      {/* Mutation error banners */}
      {insertMutation.isError && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle size={14} className="shrink-0" />
          {insertMutation.error instanceof Error
            ? insertMutation.error.message
            : "Insert failed."}
        </div>
      )}
      {updateMutation.isError && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle size={14} className="shrink-0" />
          {updateMutation.error instanceof Error
            ? updateMutation.error.message
            : "Update failed."}
        </div>
      )}
      {deleteMutation.isError && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle size={14} className="shrink-0" />
          {deleteMutation.error instanceof Error
            ? deleteMutation.error.message
            : "Delete failed."}
        </div>
      )}

      {/* No table selected */}
      {!selectedTable && (
        <div className="rounded-xl border border-border py-24 text-center text-sm text-muted-foreground">
          {schemaQuery.isLoading
            ? "Loading tables…"
            : tables.length === 0
              ? "No tables found in this database."
              : "Select a table above to browse its rows."}
        </div>
      )}

      {/* Add row form */}
      {selectedTable && addingRow && (
        <div className="mb-4 rounded-xl border border-border bg-secondary p-3">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            New row
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {columnsForForm.map((col) => (
              <div key={col} className="flex flex-col gap-1">
                <label className="font-mono text-[10px] text-muted-foreground">
                  {col}
                </label>
                <Input
                  value={newRowValues[col] ?? ""}
                  onChange={(e) =>
                    setNewRowValues((prev) => ({
                      ...prev,
                      [col]: e.target.value,
                    }))
                  }
                  placeholder="leave blank to omit"
                  disabled={insertMutation.isPending}
                  className="h-7 font-mono text-xs"
                />
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={cancelAddRow}
              disabled={insertMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={submitAddRow}
              disabled={insertMutation.isPending}
            >
              {insertMutation.isPending && (
                <Loader2 size={12} className="animate-spin" />
              )}
              Insert
            </Button>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {selectedTable && rowsQuery.isLoading && (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-10 animate-pulse rounded-xl border border-border bg-secondary"
            />
          ))}
        </div>
      )}

      {/* Error state */}
      {selectedTable && rowsQuery.isError && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle size={14} className="shrink-0" />
          Failed to load rows
          {rowsQuery.error instanceof Error
            ? `: ${rowsQuery.error.message}`
            : "."}
        </div>
      )}

      {/* Empty state */}
      {selectedTable &&
        rowsQuery.isSuccess &&
        columns.length > 0 &&
        rows.length === 0 && (
          <div className="rounded-xl border border-border py-24 text-center text-sm text-muted-foreground">
            No rows in this table{offset > 0 ? " on this page" : ""}.
          </div>
        )}

      {/* Grid */}
      {selectedTable && rowsQuery.isSuccess && columns.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {rowsQuery.data?.truncated && (
            <div className="border-b border-border bg-warn/10 px-4 py-1.5 text-[11px] text-warn">
              Results truncated.
            </div>
          )}
          <div className="max-h-[480px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {columns.map((col) => (
                    <TableHead
                      key={col}
                      className="h-8 whitespace-nowrap text-[10px] uppercase tracking-wider"
                    >
                      {col}
                    </TableHead>
                  ))}
                  <TableHead className="h-8 w-20 whitespace-nowrap text-[10px] uppercase tracking-wider text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => {
                  const key = rowKey(row, i);
                  const isEditing = editingRowKey === key;
                  return (
                    <TableRow key={key} className="hover:bg-transparent">
                      {columns.map((col, j) =>
                        isEditing ? (
                          <TableCell key={col} className="py-1">
                            <Input
                              value={editValues[col] ?? ""}
                              onChange={(e) =>
                                setEditValues((prev) => ({
                                  ...prev,
                                  [col]: e.target.value,
                                }))
                              }
                              disabled={updateMutation.isPending}
                              className="h-7 font-mono text-xs"
                            />
                          </TableCell>
                        ) : (
                          <TableCell
                            key={col}
                            className="py-1.5 whitespace-nowrap font-mono text-xs text-foreground"
                          >
                            {formatCell(row[j])}
                          </TableCell>
                        ),
                      )}
                      <TableCell className="py-1.5 text-right whitespace-nowrap">
                        {isEditing ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              onClick={() => submitEdit(row)}
                              disabled={updateMutation.isPending}
                              className="text-[11px] text-foreground hover:text-foreground/80 transition-colors disabled:opacity-40"
                            >
                              {updateMutation.isPending ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                "Save"
                              )}
                            </button>
                            <button
                              onClick={cancelEdit}
                              disabled={updateMutation.isPending}
                              className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-2">
                            <button
                              onClick={() => startEdit(row, i)}
                              disabled={!hasPk}
                              title={
                                hasPk
                                  ? undefined
                                  : "No primary key — editing unavailable"
                              }
                              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:hover:text-muted-foreground"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => requestDelete(row)}
                              disabled={!hasPk || deleteMutation.isPending}
                              title={
                                hasPk
                                  ? undefined
                                  : "No primary key — deleting unavailable"
                              }
                              className="text-destructive/80 hover:text-destructive transition-colors disabled:opacity-30 disabled:hover:text-destructive/80"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between border-t border-border px-4 py-2">
            <p className="text-[11px] text-muted-foreground">Offset {offset}</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                disabled={offset === 0 || rowsQuery.isFetching}
                className="inline-flex items-center gap-1 rounded-xl border border-border bg-secondary px-2.5 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-40"
              >
                <ChevronLeft size={12} />
                Prev
              </button>
              <button
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                disabled={rows.length < PAGE_SIZE || rowsQuery.isFetching}
                className="inline-flex items-center gap-1 rounded-xl border border-border bg-secondary px-2.5 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-40"
              >
                Next
                <ChevronRight size={12} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Destructive confirm dialog */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm row deletion</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete &&
                `Delete this row from "${selectedTable}"? This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
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
