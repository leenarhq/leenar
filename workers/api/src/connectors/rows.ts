import { qi } from "../schema/supabaseSchema";
import { executeSql, MAX_ROWS, type QueryResult } from "./supabase";
import { toSqlLiteral } from "./sqlLiteral";

export interface RowsPage {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  limit: number;
  offset: number;
}

export interface SelectRowsOptions {
  limit: number;
  offset: number;
  orderBy?: string;
  orderDir?: "asc" | "desc";
}

/**
 * Capped, paginated `SELECT * FROM public.<table>` against a provisioned
 * Supabase project, run in "read" mode (wrapped in a read-only transaction
 * by `executeSql`). `table` and `orderBy` are identifiers — quoted via `qi`,
 * never value-encoded. `limit`/`offset` are coerced to integers and spliced
 * directly: safe because they are numbers, not strings, by the time they
 * reach the SQL template below.
 */
export async function selectRows(
  token: string,
  ref: string,
  table: string,
  opts: SelectRowsOptions,
): Promise<RowsPage> {
  const limit = Math.min(MAX_ROWS, Math.max(1, Math.trunc(Number(opts.limit))));
  const offset = Math.max(0, Math.trunc(Number(opts.offset)));

  const orderClause = opts.orderBy
    ? ` ORDER BY ${qi(opts.orderBy)} ${opts.orderDir === "desc" ? "DESC" : "ASC"}`
    : "";

  const sql = `SELECT * FROM public.${qi(table)}${orderClause} LIMIT ${limit} OFFSET ${offset}`;

  const result = await executeSql(token, ref, sql, "read");

  return { ...result, limit, offset };
}

// Builds an AND-joined WHERE clause from a primary-key object. Every
// identifier goes through `qi`, every value through `toSqlLiteral` — this is
// the injection boundary shared by updateRowByPk/deleteRowByPk. A null pk
// value must emit `IS NULL`, since SQL `= NULL` never matches (it's neither
// true nor false — it's NULL).
function buildPkWhere(pk: Record<string, unknown>): string {
  return Object.entries(pk)
    .map(([k, v]) =>
      v == null ? `${qi(k)} IS NULL` : `${qi(k)} = ${toSqlLiteral(v)}`,
    )
    .join(" AND ");
}

/**
 * Inserts a single row into a provisioned Supabase project's `public.<table>`,
 * run in "write" mode. Every column name goes through `qi`, every value
 * through `toSqlLiteral` — the Management API has no bind params, so this is
 * the only place injection can be prevented. Throws BEFORE building SQL if
 * `values` is empty (an empty INSERT is meaningless and likely a caller bug).
 */
export async function insertRow(
  token: string,
  ref: string,
  table: string,
  values: Record<string, unknown>,
): Promise<QueryResult> {
  const entries = Object.entries(values);
  if (entries.length === 0) throw new Error("insertRow: no values");

  const cols = entries.map(([k]) => qi(k)).join(", ");
  const vals = entries.map(([, v]) => toSqlLiteral(v)).join(", ");

  const sql = `INSERT INTO public.${qi(table)} (${cols}) VALUES (${vals}) RETURNING *;`;

  return executeSql(token, ref, sql, "write");
}

/**
 * Updates a single row (identified by primary key) in a provisioned
 * Supabase project's `public.<table>`, run in "write" mode. Throws BEFORE
 * building SQL if `values` or `pk` is empty — an empty WHERE clause would
 * silently update every row in the table, which is never the intent of a
 * by-PK update.
 */
export async function updateRowByPk(
  token: string,
  ref: string,
  table: string,
  pk: Record<string, unknown>,
  values: Record<string, unknown>,
): Promise<QueryResult> {
  const valueEntries = Object.entries(values);
  if (valueEntries.length === 0) throw new Error("updateRowByPk: no values");
  if (Object.keys(pk).length === 0)
    throw new Error("updateRowByPk: empty primary key");

  const set = valueEntries
    .map(([k, v]) => `${qi(k)} = ${toSqlLiteral(v)}`)
    .join(", ");
  const where = buildPkWhere(pk);

  const sql = `UPDATE public.${qi(table)} SET ${set} WHERE ${where} RETURNING *;`;

  return executeSql(token, ref, sql, "write");
}

/**
 * Deletes a single row (identified by primary key) from a provisioned
 * Supabase project's `public.<table>`, run in "write" mode. Throws BEFORE
 * building SQL if `pk` is empty — an empty WHERE clause would silently
 * delete every row in the table.
 */
export async function deleteRowByPk(
  token: string,
  ref: string,
  table: string,
  pk: Record<string, unknown>,
): Promise<QueryResult> {
  if (Object.keys(pk).length === 0)
    throw new Error("deleteRowByPk: empty primary key");

  const where = buildPkWhere(pk);
  const sql = `DELETE FROM public.${qi(table)} WHERE ${where} RETURNING *;`;

  return executeSql(token, ref, sql, "write");
}
