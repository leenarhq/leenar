import { describe, it, expect, vi, beforeEach } from "vitest";
import { introspectSchema } from "./supabase";

// runQuery is called once per catalog query in order:
// [columns, primaryKeys, uniques, foreignKeys, indexes, rls]
function mockRunQuery(responses: unknown[][]) {
  let i = 0;
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () =>
      ({ ok: true, json: async () => responses[i++] }) as unknown as Response,
    );
}

describe("introspectSchema", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("assembles tables with columns, keys, indexes and RLS", async () => {
    mockRunQuery([
      // columns
      [
        { table_name: "users", column_name: "id", data_type: "uuid", is_nullable: "NO", column_default: "gen_random_uuid()" },
        { table_name: "users", column_name: "email", data_type: "text", is_nullable: "NO", column_default: null },
      ],
      // primary keys
      [{ table_name: "users", column_name: "id" }],
      // uniques
      [{ table_name: "users", column_name: "email" }],
      // foreign keys
      [],
      // indexes
      [{ tablename: "users", indexname: "users_pkey", indexdef: "CREATE UNIQUE INDEX users_pkey ON users(id)" }],
      // rls
      [{ table_name: "users", rls_enabled: true }],
    ]);

    const schema = await introspectSchema("tok", "abc-ref");
    expect(schema.tables).toHaveLength(1);
    const t = schema.tables[0];
    expect(t.name).toBe("users");
    expect(t.rlsEnabled).toBe(true);
    expect(t.columns.find((c) => c.name === "id")?.isPrimaryKey).toBe(true);
    expect(t.columns.find((c) => c.name === "email")?.isUnique).toBe(true);
    expect(t.indexes[0].name).toBe("users_pkey");
  });
});
