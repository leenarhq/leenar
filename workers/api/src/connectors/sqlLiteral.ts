// The Supabase Management API (`POST /v1/projects/{ref}/database/query`)
// takes a RAW SQL string — there are NO bind parameters. That means every
// value spliced into a query built for row CRUD must go through
// exactly one audited encoder: this one. Identifiers go through `qi`
// (schema/supabaseSchema.ts) instead; this file is the value-literal half.
//
// Why doubling the single quote is sufficient: Postgres (and Supabase's
// managed Postgres) runs with `standard_conforming_strings` ON by default,
// which means backslashes inside a string literal are ORDINARY characters,
// not escape introducers. The only character that terminates a `'...'`
// string literal is an unescaped single quote, and the only valid escape
// for a literal single quote inside such a string is doubling it (`''`).
// So replacing every `'` with `''` is both necessary and sufficient to keep
// a value inside its own literal — there is no backslash-escape path to
// also worry about (that only applies to Postgres's non-standard `E'...'`
// escape strings, which this encoder never emits).
export function toSqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";

  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";

  if (typeof v === "number") {
    if (!Number.isFinite(v)) {
      throw new Error(`Unsupported SQL literal value: ${String(v)}`);
    }
    return String(v);
  }

  if (typeof v === "bigint") return String(v);

  if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;

  if (typeof v === "object") {
    return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  }

  // symbol / function (and anything else typeof doesn't classify above).
  throw new Error(`Unsupported SQL literal type: ${typeof v}`);
}
