// Mirrors backend read shapes from workers/api/src/connectors/supabase.ts
// (LiveColumn/LiveIndex/LivePolicy/LiveTable/LiveSchema types + introspectSchema)
// and the routes in workers/api/src/routes/database.ts. Keep in sync with the
// backend.

export type LiveColumn = {
  name: string;
  dataType: string;
  nullable: boolean;
  default: string | null;
  isPrimaryKey: boolean;
  isUnique: boolean;
  isForeignKey: boolean;
};

export type LiveIndex = {
  name: string;
  definition: string;
};

export type LivePolicy = {
  name: string;
  command: string; // pg_policies.cmd: 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'
  roles: string[]; // pg_policies.roles (text[])
  using: string | null; // pg_policies.qual
  withCheck: string | null; // pg_policies.with_check
  permissive: boolean; // pg_policies.permissive === 'PERMISSIVE'
};

export type LiveTable = {
  name: string;
  columns: LiveColumn[];
  indexes: LiveIndex[];
  rlsEnabled: boolean;
  policies: LivePolicy[];
};

export type LiveSchema = {
  tables: LiveTable[];
};

export type QueryResult = {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
};

// Mirrors workers/api/src/connectors/rows.ts's RowsPage — the capped,
// paginated response shape for GET /tables/:table/rows.
export type RowsPage = {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  limit: number;
  offset: number;
};

// Mirrors workers/api/src/schema/supabaseSchema.ts's TableDef/ColumnDef —
// the draft-canvas seed shape (distinct from LiveTable/LiveColumn above,
// which describe an introspected live database).
export type ColumnDef = {
  name: string;
  type: string;
  nullable?: boolean;
  unique?: boolean;
  default?: string;
};

export type TableDef = {
  name: string;
  columns: ColumnDef[];
};

// Mirrors workers/api/src/schema/supabaseSchema.ts's ColumnChange + the
// SchemaMutation union exactly (11 kinds). Used by mutateDatabaseSchema
// (POST /mutate) in lib/api.ts. Keep in sync with the backend.
export type ColumnChange = {
  type?: string;
  nullable?: boolean;
  default?: string | null;
};

export type SchemaMutation =
  | { kind: "createTable"; table: TableDef }
  | { kind: "dropTable"; table: string }
  | { kind: "addColumn"; table: string; column: ColumnDef }
  | { kind: "dropColumn"; table: string; column: string }
  | {
      kind: "alterColumn";
      table: string;
      column: string;
      changes: ColumnChange;
    }
  | { kind: "renameColumn"; table: string; from: string; to: string }
  | {
      kind: "createIndex";
      table: string;
      columns: string[];
      unique?: boolean;
      name?: string;
    }
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

// Mirrors workers/api/src/schema/extensions.ts's ExtensionInfo — the closed
// whitelist of enable/disable-able Postgres extensions (Task 8/9). Backend
// only ever returns entries for the whitelist, annotated with live install
// state — never arbitrary installed extensions.
export type ExtensionInfo = {
  name: string;
  installed: boolean;
  installedVersion: string | null;
  description: string;
};

// Mirrors workers/api/src/routes/database.ts's snippet endpoints. Saved SQL
// snippets live in LEENAR'S OWN Postgres (via sb()), scoped by
// user+project+node — never the user's Supabase project. See
// listSnippets/createSnippet/deleteSnippet in lib/api.ts.
export type Snippet = {
  id: string;
  name: string;
  sql: string;
  createdAt: string;
};
