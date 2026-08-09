import React, { useState } from "react";
import { Trash2, ChevronDown, Plus } from "lucide-react";
import { RESERVED_COLS } from "./databaseConstants";

// ── Supabase Tables Editor ─────────────────────────────────────

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
export const COL_TYPES = [
  "text",
  "int",
  "bigint",
  "boolean",
  "uuid",
  "timestamptz",
  "jsonb",
  "numeric",
] as const;

export type ColDef = {
  name: string;
  type: string;
  nullable?: boolean;
  unique?: boolean;
  default?: string;
};

export type TableDef = { name: string; columns: ColDef[] };

export function TableEditor({
  tables,
  onChange,
}: {
  tables: TableDef[];
  onChange: (t: TableDef[]) => void;
}) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const addTable = () => {
    const next = [...tables, { name: "", columns: [] }];
    onChange(next);
    setExpandedIdx(next.length - 1);
  };

  const removeTable = (i: number) => {
    onChange(tables.filter((_, idx) => idx !== i));
    if (expandedIdx === i) setExpandedIdx(null);
    else if (expandedIdx !== null && i < expandedIdx)
      setExpandedIdx(expandedIdx - 1);
  };

  const updateTable = (i: number, patch: Partial<TableDef>) =>
    onChange(tables.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));

  const addColumn = (ti: number) =>
    updateTable(ti, {
      columns: [...tables[ti].columns, { name: "", type: "text" }],
    });

  const removeColumn = (ti: number, ci: number) =>
    updateTable(ti, {
      columns: tables[ti].columns.filter((_, idx) => idx !== ci),
    });

  const updateColumn = (ti: number, ci: number, patch: Partial<ColDef>) =>
    updateTable(ti, {
      columns: tables[ti].columns.map((c, idx) =>
        idx === ci ? { ...c, ...patch } : c,
      ),
    });

  return (
    <div className="space-y-2">
      {tables.map((table, ti) => {
        const nameErr = table.name && !IDENT_RE.test(table.name);
        const expanded = expandedIdx === ti;
        return (
          <div
            key={ti}
            className="rounded-xl border border-white/[0.07] bg-white/[0.02]"
          >
            <div
              className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
              onClick={() => setExpandedIdx(expanded ? null : ti)}
            >
              <ChevronDown
                size={12}
                className={`text-white/30 transition-transform flex-shrink-0 ${expanded ? "" : "-rotate-90"}`}
              />
              <input
                type="text"
                placeholder="table_name"
                value={table.name}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                onChange={(e) => updateTable(ti, { name: e.target.value })}
                className={`flex-1 bg-transparent text-[13px] outline-none placeholder:text-white/20 font-mono min-w-0 ${nameErr ? "text-destructive" : "text-white/80"}`}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeTable(ti);
                }}
                className="text-white/20 hover:text-red-400/70 transition-colors flex-shrink-0"
              >
                <Trash2 size={12} />
              </button>
            </div>

            {nameErr && (
              <p className="px-4 pb-1.5 text-[11px] text-destructive/80">
                Must start with letter or _, letters/digits/_ only
              </p>
            )}

            {expanded && (
              <div className="border-t border-white/[0.05] px-3 py-2.5 space-y-2">
                {/* Auto: id */}
                <div className="flex items-center gap-2 px-1 opacity-30 text-[11px] font-mono py-0.5">
                  <span className="w-[88px] shrink-0">id</span>
                  <span className="text-white/50">uuid · PK · auto</span>
                </div>

                {/* User columns */}
                {table.columns.map((col, ci) => {
                  const colNameErr = col.name && !IDENT_RE.test(col.name);
                  const reserved = RESERVED_COLS.has(col.name);
                  return (
                    <div key={ci} className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          placeholder="col_name"
                          value={col.name}
                          onChange={(e) =>
                            updateColumn(ti, ci, { name: e.target.value })
                          }
                          className={`w-[88px] shrink-0 bg-surface-container-low border rounded px-2 py-1 text-[11px] font-mono outline-none text-white/80 ${colNameErr || reserved ? "border-destructive/60" : "border-white/[0.07]"}`}
                        />
                        <select
                          value={col.type}
                          onChange={(e) =>
                            updateColumn(ti, ci, { type: e.target.value })
                          }
                          className="flex-1 bg-surface-container-low border border-white/[0.07] rounded px-2 py-1 text-[11px] text-white/70 outline-none"
                        >
                          {COL_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => removeColumn(ti, ci)}
                          className="text-white/20 hover:text-red-400/70 transition-colors shrink-0"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                      {reserved && (
                        <p className="text-[10px] text-destructive/70 px-1">
                          &ldquo;{col.name}&rdquo; is a reserved column name
                        </p>
                      )}
                      {colNameErr && !reserved && (
                        <p className="text-[10px] text-destructive/70 px-1">
                          Invalid identifier
                        </p>
                      )}
                      <div className="flex items-center gap-3 px-1 flex-wrap">
                        <label className="flex items-center gap-1.5 text-[11px] text-white/30 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={col.nullable !== false}
                            onChange={(e) =>
                              updateColumn(ti, ci, {
                                nullable: e.target.checked ? undefined : false,
                              })
                            }
                            className="w-3 h-3 rounded accent-primary"
                          />
                          nullable
                        </label>
                        <label className="flex items-center gap-1.5 text-[11px] text-white/30 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={col.unique === true}
                            onChange={(e) =>
                              updateColumn(ti, ci, {
                                unique: e.target.checked || undefined,
                              })
                            }
                            className="w-3 h-3 rounded accent-primary"
                          />
                          unique
                        </label>
                        <input
                          type="text"
                          placeholder="default…"
                          value={col.default ?? ""}
                          onChange={(e) =>
                            updateColumn(ti, ci, {
                              default: e.target.value || undefined,
                            })
                          }
                          className="flex-1 min-w-[80px] bg-surface-container-low border border-white/[0.07] rounded px-2 py-1 text-[11px] font-mono text-white/70 outline-none placeholder:text-white/20"
                        />
                      </div>
                    </div>
                  );
                })}

                {/* Auto: created_at */}
                <div className="flex items-center gap-2 px-1 opacity-30 text-[11px] font-mono py-0.5">
                  <span className="w-[88px] shrink-0">created_at</span>
                  <span className="text-white/50">timestamptz · auto</span>
                </div>

                <button
                  onClick={() => addColumn(ti)}
                  className="flex items-center gap-1.5 text-[11px] text-white/30 hover:text-white/60 transition-colors px-1 py-0.5 mt-1"
                >
                  <Plus size={11} />
                  Add column
                </button>
              </div>
            )}
          </div>
        );
      })}

      <button
        onClick={addTable}
        className="flex items-center gap-1.5 w-full px-3 py-2 rounded-xl border border-dashed border-white/[0.07] text-[12px] text-white/25 hover:text-white/50 hover:border-white/[0.12] transition-all"
      >
        <Plus size={12} />
        Add table
      </button>
    </div>
  );
}
