import { useState } from "react";
import { KeyRound, Fingerprint, Link2, Plus, Trash2 } from "lucide-react";
import type {
  LiveColumn,
  LiveTable,
  SchemaMutation,
} from "../../lib/databaseTypes";
import { Badge } from "../ui/badge";
import { Switch } from "../ui/switch";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "../ui/table";
import {
  AddColumnForm,
  ColumnEditRow,
  AddIndexForm,
  IndexRow,
  RESERVED_COLS,
} from "./tableEditControls";

// What the destructive confirm dialog is about to do.
export type PendingDestructive =
  | { kind: "dropTable"; table: string }
  | { kind: "dropColumn"; table: string; column: string }
  | { kind: "dropIndex"; name: string };

export function RlsBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
        enabled
          ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
          : "text-yellow-400 bg-yellow-500/10 border-yellow-500/20"
      }`}
    >
      RLS {enabled ? "enabled" : "disabled"}
    </span>
  );
}

function ColumnKeyBadges({ column }: { column: LiveColumn }) {
  return (
    <div className="flex items-center gap-1">
      {column.isPrimaryKey && (
        <Badge
          variant="outline"
          className="gap-1 border-amber-500/30 bg-amber-500/10 px-1.5 py-0 text-[9px] uppercase tracking-wider text-amber-400"
        >
          <KeyRound size={9} /> PK
        </Badge>
      )}
      {column.isUnique && (
        <Badge
          variant="outline"
          className="gap-1 border-sky-500/30 bg-sky-500/10 px-1.5 py-0 text-[9px] uppercase tracking-wider text-sky-400"
        >
          <Fingerprint size={9} /> Unique
        </Badge>
      )}
      {column.isForeignKey && (
        <Badge
          variant="outline"
          className="gap-1 border-purple-500/30 bg-purple-500/10 px-1.5 py-0 text-[9px] uppercase tracking-wider text-purple-400"
        >
          <Link2 size={9} /> FK
        </Badge>
      )}
    </div>
  );
}

export function TableDetail({
  table,
  isPending,
  onMutate,
  onDropRequest,
}: {
  table: LiveTable;
  isPending: boolean;
  onMutate: (m: SchemaMutation) => void;
  onDropRequest: (target: PendingDestructive) => void;
}) {
  const [addingColumn, setAddingColumn] = useState(false);
  const [addingIndex, setAddingIndex] = useState(false);

  return (
    <div className="border-t border-border">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Columns
        </p>
        <div className="flex items-center gap-2">
          <RlsBadge enabled={table.rlsEnabled} />
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            RLS
            <Switch
              checked={table.rlsEnabled}
              disabled={isPending}
              onCheckedChange={(checked) =>
                onMutate({
                  kind: "setRls",
                  table: table.name,
                  enabled: checked,
                })
              }
            />
          </label>
        </div>
      </div>

      <div className="px-4 py-3">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8 text-[10px] uppercase tracking-wider">
                Name
              </TableHead>
              <TableHead className="h-8 text-[10px] uppercase tracking-wider">
                Type
              </TableHead>
              <TableHead className="h-8 text-[10px] uppercase tracking-wider">
                Nullable
              </TableHead>
              <TableHead className="h-8 text-[10px] uppercase tracking-wider">
                Default
              </TableHead>
              <TableHead className="h-8 text-[10px] uppercase tracking-wider">
                Keys
              </TableHead>
              <TableHead className="h-8 text-[10px] uppercase tracking-wider w-6" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.columns.map((column) => {
              const reserved = RESERVED_COLS.has(column.name);
              return (
                <TableRow key={column.name} className="hover:bg-transparent">
                  <TableCell className="py-1.5 font-mono text-xs text-foreground">
                    {column.name}
                  </TableCell>
                  <TableCell className="py-1.5 font-mono text-xs text-muted-foreground">
                    {column.dataType}
                  </TableCell>
                  <TableCell className="py-1.5 text-xs text-muted-foreground">
                    {column.nullable ? "yes" : "no"}
                  </TableCell>
                  <TableCell className="py-1.5 font-mono text-xs text-muted-foreground">
                    {column.default ?? "—"}
                  </TableCell>
                  <TableCell className="py-1.5">
                    <ColumnKeyBadges column={column} />
                  </TableCell>
                  <TableCell className="py-1.5">
                    {!reserved && (
                      <ColumnEditRow
                        tableName={table.name}
                        column={column}
                        disabled={isPending}
                        onAlter={onMutate}
                        onRename={onMutate}
                        onDropRequest={(columnName) =>
                          onDropRequest({
                            kind: "dropColumn",
                            table: table.name,
                            column: columnName,
                          })
                        }
                      />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <div className="mt-2">
          {addingColumn ? (
            <AddColumnForm
              tableName={table.name}
              disabled={isPending}
              onSubmit={(m) => {
                onMutate(m);
                setAddingColumn(false);
              }}
              onCancel={() => setAddingColumn(false)}
            />
          ) : (
            <button
              onClick={() => setAddingColumn(true)}
              disabled={isPending}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <Plus size={11} />
              Add column
            </button>
          )}
        </div>
      </div>

      <div className="px-4 py-3 border-t border-border">
        <div className="mb-2 flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Indexes
          </p>
        </div>
        {table.indexes.length === 0 ? (
          <p className="mb-2 text-[11px] text-muted-foreground">No indexes.</p>
        ) : (
          <ul className="mb-2 space-y-1">
            {table.indexes.map((index) => (
              <IndexRow
                key={index.name}
                index={index}
                disabled={isPending}
                onDropRequest={(name) =>
                  onDropRequest({ kind: "dropIndex", name })
                }
              />
            ))}
          </ul>
        )}

        {addingIndex ? (
          <AddIndexForm
            tableName={table.name}
            columnNames={table.columns.map((c) => c.name)}
            disabled={isPending}
            onSubmit={(m) => {
              onMutate(m);
              setAddingIndex(false);
            }}
            onCancel={() => setAddingIndex(false)}
          />
        ) : (
          <button
            onClick={() => setAddingIndex(true)}
            disabled={isPending}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <Plus size={11} />
            Add index
          </button>
        )}
      </div>

      <div className="flex items-center justify-end border-t border-border px-4 py-2.5">
        <button
          onClick={() =>
            onDropRequest({ kind: "dropTable", table: table.name })
          }
          disabled={isPending}
          className="inline-flex items-center gap-1.5 text-[11px] text-destructive/80 hover:text-destructive transition-colors disabled:opacity-40"
        >
          <Trash2 size={11} />
          Drop table
        </button>
      </div>
    </div>
  );
}
