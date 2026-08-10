import { describe, it, expect, vi, beforeEach } from "vitest";
import { introspectSchema, parsePgTextArray } from "./supabase";

// runQuery is called once per catalog query in order:
// [columns, primaryKeys, uniques, foreignKeys, indexes, rls, policies]
function mockRunQuery(responses: unknown[][]) {
  let i = 0;
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () =>
      ({ ok: true, json: async () => responses[i++] }) as unknown as Response,
    );
}

describe("introspectSchema - RLS policies", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("maps a table with two policies to name/command/roles/using/withCheck/permissive", async () => {
    mockRunQuery([
      // columns
      [
        { table_name: "users", column_name: "id", data_type: "uuid", is_nullable: "NO", column_default: "gen_random_uuid()" },
      ],
      // primary keys
      [{ table_name: "users", column_name: "id" }],
      // uniques
      [],
      // foreign keys
      [],
      // indexes
      [],
      // rls
      [{ table_name: "users", rls_enabled: true }],
      // policies
      [
        {
          tablename: "users",
          policyname: "select_own",
          cmd: "SELECT",
          roles: ["authenticated"],
          qual: "auth.uid() = id",
          with_check: null,
          permissive: "PERMISSIVE",
        },
        {
          tablename: "users",
          policyname: "insert_own",
          cmd: "INSERT",
          roles: "{authenticated,anon}",
          qual: null,
          with_check: "auth.uid() = id",
          permissive: "RESTRICTIVE",
        },
      ],
    ]);

    const schema = await introspectSchema("tok", "abc-ref");
    const t = schema.tables.find((tbl) => tbl.name === "users");
    expect(t?.policies).toHaveLength(2);

    const p1 = t?.policies.find((p) => p.name === "select_own");
    expect(p1).toEqual({
      name: "select_own",
      command: "SELECT",
      roles: ["authenticated"],
      using: "auth.uid() = id",
      withCheck: null,
      permissive: true,
    });

    const p2 = t?.policies.find((p) => p.name === "insert_own");
    expect(p2).toEqual({
      name: "insert_own",
      command: "INSERT",
      roles: ["authenticated", "anon"],
      using: null,
      withCheck: "auth.uid() = id",
      permissive: false,
    });
  });

  it("gives a table present in cols but with no policy rows an empty policies array", async () => {
    mockRunQuery([
      // columns
      [
        { table_name: "posts", column_name: "id", data_type: "uuid", is_nullable: "NO", column_default: null },
      ],
      // primary keys
      [],
      // uniques
      [],
      // foreign keys
      [],
      // indexes
      [],
      // rls
      [{ table_name: "posts", rls_enabled: false }],
      // policies
      [],
    ]);

    const schema = await introspectSchema("tok", "abc-ref");
    const t = schema.tables.find((tbl) => tbl.name === "posts");
    expect(t?.policies).toEqual([]);
  });

  it("skips policy rows whose table isn't in the map", async () => {
    mockRunQuery([
      [{ table_name: "users", column_name: "id", data_type: "uuid", is_nullable: "NO", column_default: null }],
      [],
      [],
      [],
      [],
      [{ table_name: "users", rls_enabled: true }],
      [
        {
          tablename: "ghost_table",
          policyname: "orphan_policy",
          cmd: "ALL",
          roles: [],
          qual: null,
          with_check: null,
          permissive: "PERMISSIVE",
        },
      ],
    ]);

    const schema = await introspectSchema("tok", "abc-ref");
    expect(schema.tables).toHaveLength(1);
    expect(schema.tables[0].policies).toEqual([]);
  });
});

describe("parsePgTextArray", () => {
  it("maps a JS array to a string array", () => {
    expect(parsePgTextArray(["a", "b"])).toEqual(["a", "b"]);
  });

  it("parses a Postgres brace-string into a string array", () => {
    expect(parsePgTextArray("{authenticated,anon}")).toEqual([
      "authenticated",
      "anon",
    ]);
  });

  it("parses an empty brace-string into an empty array", () => {
    expect(parsePgTextArray("{}")).toEqual([]);
  });

  it("returns an empty array for null", () => {
    expect(parsePgTextArray(null)).toEqual([]);
  });

  it("returns an empty array for undefined", () => {
    expect(parsePgTextArray(undefined)).toEqual([]);
  });

  it("returns an empty array for other types", () => {
    expect(parsePgTextArray(42)).toEqual([]);
  });
});
