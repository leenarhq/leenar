const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const ALLOWED_TYPES = [
  "text",
  "int",
  "bigint",
  "boolean",
  "uuid",
  "timestamptz",
  "jsonb",
  "numeric",
] as const;
type ColumnType = (typeof ALLOWED_TYPES)[number];

const TYPE_MAP: Record<ColumnType, string> = {
  text: "text",
  int: "integer",
  bigint: "bigint",
  boolean: "boolean",
  uuid: "uuid",
  timestamptz: "timestamptz",
  jsonb: "jsonb",
  numeric: "numeric",
};

const SAFE_DEFAULTS = new Set(["now()", "gen_random_uuid()"]);
export const RESERVED_COLS = new Set(["id", "created_at"]);

export interface ColumnDef {
  name: string;
  type: string;
  nullable?: boolean;
  unique?: boolean;
  default?: string;
}

export interface TableDef {
  name: string;
  columns: ColumnDef[];
}

export function qi(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function ql(val: string): string {
  // PostgreSQL standard_conforming_strings=on (Supabase default): backslash is literal,
  // only single quotes need escaping by doubling.
  return `'${val.replace(/'/g, "''")}'`;
}

function validateDefault(val: string, type: ColumnType): string {
  if (SAFE_DEFAULTS.has(val)) return val;
  switch (type) {
    case "boolean":
      if (val !== "true" && val !== "false")
        throw new Error(`Invalid boolean default: "${val}"`);
      return val;
    case "int":
    case "bigint":
      if (!/^-?\d+$/.test(val))
        throw new Error(`Invalid integer default: "${val}"`);
      return val;
    case "numeric":
      if (!/^-?\d+(\.\d+)?$/.test(val))
        throw new Error(`Invalid numeric default: "${val}"`);
      return val;
    default:
      return ql(val);
  }
}

export function buildDDL(tables: TableDef[]): string {
  const stmts: string[] = [];

  for (const table of tables) {
    if (!IDENTIFIER_RE.test(table.name))
      throw new Error(`Invalid table name: "${table.name}"`);

    const cols: string[] = [
      `${qi("id")} uuid PRIMARY KEY DEFAULT gen_random_uuid()`,
    ];

    for (const col of table.columns) {
      if (!IDENTIFIER_RE.test(col.name))
        throw new Error(
          `Invalid column name: "${col.name}" in table "${table.name}"`,
        );
      if (RESERVED_COLS.has(col.name))
        throw new Error(
          `Column name "${col.name}" is reserved in table "${table.name}"`,
        );

      const type = col.type as ColumnType;
      if (!ALLOWED_TYPES.includes(type))
        throw new Error(
          `Invalid column type: "${col.type}" in table "${table.name}"`,
        );

      let def = `${qi(col.name)} ${TYPE_MAP[type]}`;
      if (col.nullable === false) def += " NOT NULL";
      if (col.default !== undefined)
        def += ` DEFAULT ${validateDefault(col.default, type)}`;
      if (col.unique) def += " UNIQUE";
      cols.push(def);
    }

    cols.push(`${qi("created_at")} timestamptz DEFAULT now()`);

    const tq = qi(table.name);
    stmts.push(
      `CREATE TABLE IF NOT EXISTS ${tq} (\n  ${cols.join(",\n  ")}\n);\nALTER TABLE ${tq} ENABLE ROW LEVEL SECURITY;`,
    );
  }

  return stmts.join("\n\n");
}

function defaultFallback(type: ColumnType): string {
  switch (type) {
    case "text":
      return "''";
    case "int":
    case "bigint":
    case "numeric":
      return "0";
    case "boolean":
      return "false";
    case "uuid":
      return "gen_random_uuid()";
    case "timestamptz":
      return "now()";
    case "jsonb":
      return "'null'";
  }
}

export function buildAlterStatements(
  table: TableDef,
  appliedCols: string[],
): string {
  if (!IDENTIFIER_RE.test(table.name))
    throw new Error(`Invalid table name: "${table.name}"`);

  const applied = new Set(appliedCols);
  const stmts: string[] = [];

  for (const col of table.columns) {
    if (applied.has(col.name)) continue;
    if (RESERVED_COLS.has(col.name)) continue;
    if (!IDENTIFIER_RE.test(col.name))
      throw new Error(
        `Invalid column name: "${col.name}" in table "${table.name}"`,
      );

    const type = col.type as ColumnType;
    if (!ALLOWED_TYPES.includes(type))
      throw new Error(
        `Invalid column type: "${col.type}" in table "${table.name}"`,
      );

    let def = `${qi(col.name)} ${TYPE_MAP[type]}`;
    if (col.nullable === false) {
      const fallback = defaultFallback(type);
      const d =
        col.default !== undefined
          ? validateDefault(col.default, type)
          : fallback;
      def += ` NOT NULL DEFAULT ${d}`;
    } else if (col.default !== undefined) {
      def += ` DEFAULT ${validateDefault(col.default, type)}`;
    }

    stmts.push(
      `ALTER TABLE ${qi(table.name)} ADD COLUMN IF NOT EXISTS ${def};`,
    );
  }

  return stmts.join("\n");
}

export interface ColumnChange {
  type?: string; // new ColumnType; when present drives default validation
  nullable?: boolean; // true → DROP NOT NULL; false → SET NOT NULL
  default?: string | null; // string → SET DEFAULT <validated>; null → DROP DEFAULT; undefined → leave
}

export type SchemaMutation =
  | { kind: "createTable"; table: TableDef }
  | { kind: "dropTable"; table: string }
  | { kind: "addColumn"; table: string; column: ColumnDef }
  | { kind: "dropColumn"; table: string; column: string }
  | { kind: "alterColumn"; table: string; column: string; changes: ColumnChange }
  | { kind: "renameColumn"; table: string; from: string; to: string }
  | { kind: "createIndex"; table: string; columns: string[]; unique?: boolean; name?: string }
  | { kind: "dropIndex"; name: string }
  | { kind: "setRls"; table: string; enabled: boolean }
  | {
      kind: "createPolicy";
      table: string;
      name: string;
      command: "ALL" | "SELECT" | "INSERT" | "UPDATE" | "DELETE";
      roles?: string[];
      using?: string;
      withCheck?: string;
    }
  | { kind: "dropPolicy"; table: string; name: string };

const POLICY_COMMANDS = ["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"] as const;
type PolicyCommand = (typeof POLICY_COMMANDS)[number];

function assertTableName(name: string): void {
  if (!IDENTIFIER_RE.test(name)) throw new Error(`Invalid table name: "${name}"`);
}

function assertColumnName(name: string): void {
  if (!IDENTIFIER_RE.test(name)) throw new Error(`Invalid column name: "${name}"`);
}

function assertIndexName(name: string): void {
  if (!IDENTIFIER_RE.test(name)) throw new Error(`Invalid index name: "${name}"`);
}

function assertPolicyName(name: string): void {
  if (!IDENTIFIER_RE.test(name)) throw new Error(`Invalid policy name: "${name}"`);
}

// Defense-in-depth for raw policy predicates: they are intentionally raw SQL
// (identifiers + function calls), so we only reject statement-splicing chars.
function assertSafePredicate(label: string, val: string): void {
  if (val.includes(";") || val.includes("\n") || val.includes("\r"))
    throw new Error(`Unsafe ${label} in policy predicate: ${JSON.stringify(val)}`);
}

function assertColumnType(type: string): asserts type is ColumnType {
  if (!ALLOWED_TYPES.includes(type as ColumnType))
    throw new Error(`Invalid column type: "${type}"`);
}

export function buildMutationDDL(m: SchemaMutation): string {
  switch (m.kind) {
    case "createTable": {
      return buildDDL([m.table]);
    }

    case "dropTable": {
      assertTableName(m.table);
      return `DROP TABLE IF EXISTS ${qi(m.table)};`;
    }

    case "addColumn": {
      assertTableName(m.table);
      assertColumnName(m.column.name);
      if (RESERVED_COLS.has(m.column.name))
        throw new Error(`Column name "${m.column.name}" is reserved`);
      assertColumnType(m.column.type);
      const type = m.column.type as ColumnType;

      let def = `${qi(m.column.name)} ${TYPE_MAP[type]}`;
      if (m.column.nullable === false) def += " NOT NULL";
      if (m.column.default !== undefined)
        def += ` DEFAULT ${validateDefault(m.column.default, type)}`;
      if (m.column.unique) def += " UNIQUE";

      return `ALTER TABLE ${qi(m.table)} ADD COLUMN IF NOT EXISTS ${def};`;
    }

    case "dropColumn": {
      assertTableName(m.table);
      assertColumnName(m.column);
      if (RESERVED_COLS.has(m.column))
        throw new Error(`Column "${m.column}" is reserved and cannot be dropped`);
      return `ALTER TABLE ${qi(m.table)} DROP COLUMN IF EXISTS ${qi(m.column)};`;
    }

    case "alterColumn": {
      assertTableName(m.table);
      assertColumnName(m.column);
      if (RESERVED_COLS.has(m.column))
        throw new Error(`Column "${m.column}" is reserved and cannot be altered`);

      const { changes } = m;
      const stmts: string[] = [];
      const tq = qi(m.table);
      const cq = qi(m.column);

      if (changes.type !== undefined) {
        assertColumnType(changes.type);
        stmts.push(`ALTER TABLE ${tq} ALTER COLUMN ${cq} TYPE ${TYPE_MAP[changes.type as ColumnType]};`);
      }

      if (changes.nullable !== undefined) {
        stmts.push(
          changes.nullable === false
            ? `ALTER TABLE ${tq} ALTER COLUMN ${cq} SET NOT NULL;`
            : `ALTER TABLE ${tq} ALTER COLUMN ${cq} DROP NOT NULL;`,
        );
      }

      if (changes.default !== undefined) {
        if (changes.default === null) {
          stmts.push(`ALTER TABLE ${tq} ALTER COLUMN ${cq} DROP DEFAULT;`);
        } else {
          const defType = (changes.type as ColumnType) ?? "text";
          assertColumnType(defType);
          stmts.push(
            `ALTER TABLE ${tq} ALTER COLUMN ${cq} SET DEFAULT ${validateDefault(changes.default, defType)};`,
          );
        }
      }

      if (stmts.length === 0) throw new Error("alterColumn: no changes specified");

      return stmts.join("\n");
    }

    case "renameColumn": {
      assertTableName(m.table);
      assertColumnName(m.from);
      assertColumnName(m.to);
      if (RESERVED_COLS.has(m.from))
        throw new Error(`Column "${m.from}" is reserved and cannot be renamed`);
      return `ALTER TABLE ${qi(m.table)} RENAME COLUMN ${qi(m.from)} TO ${qi(m.to)};`;
    }

    case "createIndex": {
      assertTableName(m.table);
      if (m.columns.length < 1) throw new Error("createIndex: no columns");
      for (const c of m.columns) assertColumnName(c);
      const name = m.name ?? `idx_${m.table}_${m.columns.join("_")}`;
      assertIndexName(name);
      const uniqueKw = m.unique === true ? "UNIQUE " : "";
      const cols = m.columns.map((c) => qi(c)).join(", ");
      return `CREATE ${uniqueKw}INDEX IF NOT EXISTS ${qi(name)} ON ${qi(m.table)} (${cols});`;
    }

    case "dropIndex": {
      assertIndexName(m.name);
      return `DROP INDEX IF EXISTS ${qi(m.name)};`;
    }

    case "setRls": {
      assertTableName(m.table);
      return m.enabled
        ? `ALTER TABLE ${qi(m.table)} ENABLE ROW LEVEL SECURITY;`
        : `ALTER TABLE ${qi(m.table)} DISABLE ROW LEVEL SECURITY;`;
    }

    case "dropPolicy": {
      assertTableName(m.table);
      assertPolicyName(m.name);
      return `DROP POLICY IF EXISTS ${qi(m.name)} ON ${qi(m.table)};`;
    }

    case "createPolicy": {
      assertPolicyName(m.name);
      assertTableName(m.table);
      if (!POLICY_COMMANDS.includes(m.command as PolicyCommand))
        throw new Error(`Invalid policy command: "${m.command}"`);

      const roles = m.roles ?? [];
      const roleList =
        roles.length === 0
          ? "public"
          : roles
              .map((r) => {
                if (!IDENTIFIER_RE.test(r)) throw new Error(`Invalid role: "${r}"`);
                return r;
              })
              .join(", ");

      const lines = [
        `CREATE POLICY ${qi(m.name)} ON ${qi(m.table)}`,
        `  FOR ${m.command}`,
        `  TO ${roleList}`,
      ];

      // Note: we intentionally do NOT enforce Postgres's per-command
      // USING/WITH-CHECK legality (e.g. that INSERT forbids USING) here —
      // invalid combinations are left for Postgres to reject at execution
      // time, surfacing its own error rather than us reimplementing it.
      if (typeof m.using === "string" && m.using.length > 0) {
        assertSafePredicate("using", m.using);
        lines.push(`  USING (${m.using})`);
      }
      if (typeof m.withCheck === "string" && m.withCheck.length > 0) {
        assertSafePredicate("withCheck", m.withCheck);
        lines.push(`  WITH CHECK (${m.withCheck})`);
      }

      return `${lines.join("\n")};`;
    }
  }
}

/**
 * Applies a single SchemaMutation to a draft canvas seed (`TableDef[]`) —
 * the counterpart to buildMutationDDL for nodes with no live database yet.
 * Pure: always returns a NEW array, never mutates `tables` or its entries.
 *
 * createIndex/dropIndex/setRls/createPolicy/dropPolicy have no representation
 * in the seed TableDef shape (no indexes/RLS/policy field), so they throw —
 * the route maps that to 400.
 */
export function applyMutationToSeed(
  tables: TableDef[],
  m: SchemaMutation,
): TableDef[] {
  const findTableIndex = (name: string): number =>
    tables.findIndex((t) => t.name === name);

  switch (m.kind) {
    case "createTable": {
      if (findTableIndex(m.table.name) !== -1)
        throw new Error(`Table "${m.table.name}" already exists`);
      // Validate the new table via the same rules buildDDL enforces, then
      // discard the SQL — we only want the validation side effect here.
      buildDDL([m.table]);
      return [...tables, m.table];
    }

    case "dropTable": {
      const idx = findTableIndex(m.table);
      if (idx === -1) throw new Error(`Table "${m.table}" not found`);
      return [...tables.slice(0, idx), ...tables.slice(idx + 1)];
    }

    case "addColumn": {
      const idx = findTableIndex(m.table);
      if (idx === -1) throw new Error(`Table "${m.table}" not found`);
      const table = tables[idx];
      if (RESERVED_COLS.has(m.column.name))
        throw new Error(`Column name "${m.column.name}" is reserved`);
      if (table.columns.some((c) => c.name === m.column.name))
        throw new Error(`Column "${m.column.name}" already exists`);
      assertColumnName(m.column.name);
      assertColumnType(m.column.type);
      const nextTable: TableDef = {
        ...table,
        columns: [...table.columns, m.column],
      };
      return [...tables.slice(0, idx), nextTable, ...tables.slice(idx + 1)];
    }

    case "dropColumn": {
      const idx = findTableIndex(m.table);
      if (idx === -1) throw new Error(`Table "${m.table}" not found`);
      const table = tables[idx];
      if (RESERVED_COLS.has(m.column))
        throw new Error(`Column "${m.column}" is reserved and cannot be dropped`);
      const colIdx = table.columns.findIndex((c) => c.name === m.column);
      if (colIdx === -1) throw new Error(`Column "${m.column}" not found`);
      const nextTable: TableDef = {
        ...table,
        columns: [
          ...table.columns.slice(0, colIdx),
          ...table.columns.slice(colIdx + 1),
        ],
      };
      return [...tables.slice(0, idx), nextTable, ...tables.slice(idx + 1)];
    }

    case "alterColumn": {
      const idx = findTableIndex(m.table);
      if (idx === -1) throw new Error(`Table "${m.table}" not found`);
      const table = tables[idx];
      if (RESERVED_COLS.has(m.column))
        throw new Error(`Column "${m.column}" is reserved and cannot be altered`);
      const colIdx = table.columns.findIndex((c) => c.name === m.column);
      if (colIdx === -1) throw new Error(`Column "${m.column}" not found`);

      const { changes } = m;
      const nextCol: ColumnDef = { ...table.columns[colIdx] };

      if (changes.type !== undefined) {
        assertColumnType(changes.type);
        nextCol.type = changes.type;
      }
      if (changes.nullable !== undefined) {
        nextCol.nullable = changes.nullable;
      }
      if (changes.default === null) {
        delete nextCol.default;
      } else if (typeof changes.default === "string") {
        nextCol.default = changes.default;
      }

      const nextColumns = [...table.columns];
      nextColumns[colIdx] = nextCol;
      const nextTable: TableDef = { ...table, columns: nextColumns };
      return [...tables.slice(0, idx), nextTable, ...tables.slice(idx + 1)];
    }

    case "renameColumn": {
      const idx = findTableIndex(m.table);
      if (idx === -1) throw new Error(`Table "${m.table}" not found`);
      const table = tables[idx];
      if (RESERVED_COLS.has(m.from))
        throw new Error(`Column "${m.from}" is reserved and cannot be renamed`);
      const colIdx = table.columns.findIndex((c) => c.name === m.from);
      if (colIdx === -1) throw new Error(`Column "${m.from}" not found`);
      if (table.columns.some((c) => c.name === m.to))
        throw new Error(`Column "${m.to}" already exists`);
      assertColumnName(m.to);

      const nextColumns = [...table.columns];
      nextColumns[colIdx] = { ...nextColumns[colIdx], name: m.to };
      const nextTable: TableDef = { ...table, columns: nextColumns };
      return [...tables.slice(0, idx), nextTable, ...tables.slice(idx + 1)];
    }

    case "createIndex":
    case "dropIndex":
    case "setRls":
    case "createPolicy":
    case "dropPolicy":
      throw new Error(`${m.kind} is only supported on a provisioned database`);
  }
}

// Reverse of TYPE_MAP (live Postgres type string -> editor type vocabulary),
// plus common aliases Postgres/Supabase actually reports via introspection.
// Read-only mapping used to render a live-DB snapshot back into TableDef
// shape: unknown/unsupported pg types are preserved verbatim (never thrown,
// never dropped) since the snapshot is display-only, not DDL input.
const LIVE_TYPE_MAP: Record<string, ColumnType> = {
  integer: "int",
  int: "int",
  int4: "int",
  bigint: "bigint",
  int8: "bigint",
  text: "text",
  "character varying": "text",
  varchar: "text",
  boolean: "boolean",
  bool: "boolean",
  uuid: "uuid",
  "timestamp with time zone": "timestamptz",
  timestamptz: "timestamptz",
  jsonb: "jsonb",
  numeric: "numeric",
  decimal: "numeric",
};

export function liveTypeToEditorType(pgType: string): string {
  const key = pgType.trim().toLowerCase();
  return LIVE_TYPE_MAP[key] ?? pgType;
}

export function isLikelyDestructive(sql: string): boolean {
  const s = sql.trim().toLowerCase();
  if (/\b(drop|truncate)\b/.test(s)) return true;
  if (/\balter\b[\s\S]*\bdrop\b/.test(s)) return true;
  if (/\b(delete|update)\b/.test(s) && !/\bwhere\b/.test(s)) return true;
  return false;
}
