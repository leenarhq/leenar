import { useState } from "react";
import { Plus, Trash2, Pencil, Check, X, Loader2 } from "lucide-react";
import type {
  LiveColumn,
  LiveIndex,
  SchemaMutation,
} from "../../lib/databaseTypes";
import { COL_TYPES } from "./TableEditor";
import { RESERVED_COLS } from "./databaseConstants";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../ui/select";

export { RESERVED_COLS };

// ── Add column form ─────────────────────────────────────────────

export function AddColumnForm({
  tableName,
  disabled,
  onSubmit,
  onCancel,
}: {
  tableName: string;
  disabled: boolean;
  onSubmit: (m: Extract<SchemaMutation, { kind: "addColumn" }>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<string>(COL_TYPES[0]);
  const [nullable, setNullable] = useState(true);
  const [unique, setUnique] = useState(false);
  const [defaultVal, setDefaultVal] = useState("");

  const reserved = RESERVED_COLS.has(name);
  const canSubmit = name.trim().length > 0 && !reserved;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      kind: "addColumn",
      table: tableName,
      column: {
        name: name.trim(),
        type,
        ...(nullable ? {} : { nullable: false }),
        ...(unique ? { unique: true } : {}),
        ...(defaultVal.trim() ? { default: defaultVal.trim() } : {}),
      },
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-dashed border-border bg-secondary/10 px-2 py-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="col_name"
        disabled={disabled}
        className="h-7 w-28 font-mono text-xs"
      />
      <Select value={type} onValueChange={setType} disabled={disabled}>
        <SelectTrigger className="h-7 w-28 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COL_TYPES.map((t) => (
            <SelectItem key={t} value={t} className="text-xs">
              {t}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Checkbox
          checked={nullable}
          onCheckedChange={(v) => setNullable(v === true)}
          disabled={disabled}
        />
        nullable
      </label>
      <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Checkbox
          checked={unique}
          onCheckedChange={(v) => setUnique(v === true)}
          disabled={disabled}
        />
        unique
      </label>
      <Input
        value={defaultVal}
        onChange={(e) => setDefaultVal(e.target.value)}
        placeholder="default…"
        disabled={disabled}
        className="h-7 w-28 font-mono text-xs"
      />
      {reserved && (
        <p className="w-full text-[10px] text-destructive">
          &ldquo;{name}&rdquo; is a reserved column name
        </p>
      )}
      <div className="ml-auto flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          onClick={onCancel}
          disabled={disabled}
        >
          <X size={12} />
        </Button>
        <Button
          size="sm"
          className="h-7 px-2"
          onClick={submit}
          disabled={disabled || !canSubmit}
        >
          {disabled ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Check size={12} />
          )}
          Add
        </Button>
      </div>
    </div>
  );
}

// ── Column row edit controls (rename / alter type / nullable / default / drop) ──

export function ColumnEditRow({
  tableName,
  column,
  disabled,
  onAlter,
  onRename,
  onDropRequest,
}: {
  tableName: string;
  column: LiveColumn;
  disabled: boolean;
  onAlter: (m: Extract<SchemaMutation, { kind: "alterColumn" }>) => void;
  onRename: (m: Extract<SchemaMutation, { kind: "renameColumn" }>) => void;
  onDropRequest: (columnName: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [renameValue, setRenameValue] = useState(column.name);
  const [typeValue, setTypeValue] = useState<string>(COL_TYPES[0]);
  const [defaultValue, setDefaultValue] = useState(column.default ?? "");

  const reserved = RESERVED_COLS.has(column.name);
  if (reserved) return null;

  const applyRename = () => {
    const to = renameValue.trim();
    if (!to || to === column.name) return;
    onRename({ kind: "renameColumn", table: tableName, from: column.name, to });
  };

  const applyType = () => {
    onAlter({
      kind: "alterColumn",
      table: tableName,
      column: column.name,
      changes: { type: typeValue },
    });
  };

  const applyNullableToggle = () => {
    onAlter({
      kind: "alterColumn",
      table: tableName,
      column: column.name,
      changes: { nullable: !column.nullable },
    });
  };

  const applyDefault = () => {
    const trimmed = defaultValue.trim();
    onAlter({
      kind: "alterColumn",
      table: tableName,
      column: column.name,
      changes: { default: trimmed ? trimmed : null },
    });
  };

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        disabled={disabled}
        title="Edit column"
        className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
      >
        <Pencil size={11} />
      </button>
    );
  }

  return (
    <div className="col-span-5 mt-1 space-y-1.5 rounded-md border border-dashed border-border bg-secondary/10 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground w-14 shrink-0">
          rename
        </span>
        <Input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          disabled={disabled}
          className="h-7 w-32 font-mono text-xs"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11px]"
          onClick={applyRename}
          disabled={disabled}
        >
          Apply
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground w-14 shrink-0">
          type
        </span>
        <Select
          value={typeValue}
          onValueChange={setTypeValue}
          disabled={disabled}
        >
          <SelectTrigger className="h-7 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COL_TYPES.map((t) => (
              <SelectItem key={t} value={t} className="text-xs">
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11px]"
          onClick={applyType}
          disabled={disabled}
        >
          Apply
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground w-14 shrink-0">
          nullable
        </span>
        <span className="text-[11px] text-foreground/70">
          {column.nullable ? "yes" : "no"}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11px]"
          onClick={applyNullableToggle}
          disabled={disabled}
        >
          Toggle
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground w-14 shrink-0">
          default
        </span>
        <Input
          value={defaultValue}
          onChange={(e) => setDefaultValue(e.target.value)}
          placeholder="(none)"
          disabled={disabled}
          className="h-7 w-32 font-mono text-xs"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11px]"
          onClick={applyDefault}
          disabled={disabled}
        >
          Set
        </Button>
      </div>
      <div className="flex items-center justify-between pt-1">
        <button
          onClick={() => onDropRequest(column.name)}
          disabled={disabled || column.isPrimaryKey}
          title={
            column.isPrimaryKey
              ? "Cannot drop primary key column"
              : "Drop column"
          }
          className="inline-flex items-center gap-1 text-[11px] text-destructive/80 hover:text-destructive transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Trash2 size={11} />
          Drop column
        </button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[11px]"
          onClick={() => setEditing(false)}
        >
          Close
        </Button>
      </div>
    </div>
  );
}

// ── Add index form ──────────────────────────────────────────────

export function AddIndexForm({
  tableName,
  columnNames,
  disabled,
  onSubmit,
  onCancel,
}: {
  tableName: string;
  columnNames: string[];
  disabled: boolean;
  onSubmit: (m: Extract<SchemaMutation, { kind: "createIndex" }>) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [unique, setUnique] = useState(false);
  const [name, setName] = useState("");

  const toggleCol = (col: string) => {
    setSelected((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col],
    );
  };

  const canSubmit = selected.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      kind: "createIndex",
      table: tableName,
      columns: selected,
      ...(unique ? { unique: true } : {}),
      ...(name.trim() ? { name: name.trim() } : {}),
    });
  };

  return (
    <div className="space-y-2 rounded-md border border-dashed border-border bg-secondary/10 p-2">
      <div className="flex flex-wrap gap-1.5">
        {columnNames.map((col) => (
          <label
            key={col}
            className="flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground cursor-pointer"
          >
            <Checkbox
              checked={selected.includes(col)}
              onCheckedChange={() => toggleCol(col)}
              disabled={disabled}
            />
            {col}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Checkbox
            checked={unique}
            onCheckedChange={(v) => setUnique(v === true)}
            disabled={disabled}
          />
          unique
        </label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="index name (optional)"
          disabled={disabled}
          className="h-7 w-48 font-mono text-xs"
        />
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={onCancel}
            disabled={disabled}
          >
            <X size={12} />
          </Button>
          <Button
            size="sm"
            className="h-7 px-2"
            onClick={submit}
            disabled={disabled || !canSubmit}
          >
            {disabled ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Check size={12} />
            )}
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Index row (drop) ────────────────────────────────────────────

export function IndexRow({
  index,
  disabled,
  onDropRequest,
}: {
  index: LiveIndex;
  disabled: boolean;
  onDropRequest: (indexName: string) => void;
}) {
  const isPkIndex = index.name.endsWith("_pkey");
  return (
    <li className="flex items-center justify-between gap-2 font-mono text-[11px] text-muted-foreground">
      <span className="truncate">{index.name}</span>
      {!isPkIndex && (
        <button
          onClick={() => onDropRequest(index.name)}
          disabled={disabled}
          title="Drop index"
          className="shrink-0 text-destructive/70 hover:text-destructive transition-colors disabled:opacity-40"
        >
          <Trash2 size={11} />
        </button>
      )}
    </li>
  );
}

// ── New table button ────────────────────────────────────────────

export function NewTableButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50"
    >
      <Plus size={12} />
      New table
    </button>
  );
}
