import { describe, it, expect } from "vitest";
import {
  isLikelyDestructive,
  buildMutationDDL,
  applyMutationToSeed,
  liveTypeToEditorType,
} from "./supabaseSchema";
import type { SchemaMutation, TableDef } from "./supabaseSchema";

describe("isLikelyDestructive", () => {
  it("flags DROP / TRUNCATE", () => {
    expect(isLikelyDestructive("drop table users")).toBe(true);
    expect(isLikelyDestructive("TRUNCATE users")).toBe(true);
  });
  it("flags DELETE/UPDATE without WHERE", () => {
    expect(isLikelyDestructive("delete from users")).toBe(true);
    expect(isLikelyDestructive("update users set x = 1")).toBe(true);
  });
  it("does not flag scoped or read statements", () => {
    expect(isLikelyDestructive("select * from users")).toBe(false);
    expect(isLikelyDestructive("delete from users where id = '1'")).toBe(false);
    expect(isLikelyDestructive("update users set x=1 where id='1'")).toBe(false);
  });
});

describe("buildMutationDDL", () => {
  it("createTable delegates to buildDDL", () => {
    const m: SchemaMutation = {
      kind: "createTable",
      table: { name: "post", columns: [{ name: "title", type: "text", nullable: false }] },
    };
    const out = buildMutationDDL(m);
    expect(out).toContain('CREATE TABLE IF NOT EXISTS "post"');
    expect(out).toContain('"title" text NOT NULL');
    expect(out).toContain('ALTER TABLE "post" ENABLE ROW LEVEL SECURITY;');
  });

  it("dropTable", () => {
    const m: SchemaMutation = { kind: "dropTable", table: "post" };
    expect(buildMutationDDL(m)).toBe('DROP TABLE IF EXISTS "post";');
  });

  it("dropTable rejects invalid identifier", () => {
    const m: SchemaMutation = { kind: "dropTable", table: "a b" };
    expect(() => buildMutationDDL(m)).toThrow('Invalid table name: "a b"');
  });

  it("addColumn builds full column def", () => {
    const m: SchemaMutation = {
      kind: "addColumn",
      table: "post",
      column: { name: "title", type: "text", nullable: false },
    };
    expect(buildMutationDDL(m)).toBe(
      'ALTER TABLE "post" ADD COLUMN IF NOT EXISTS "title" text NOT NULL;',
    );
  });

  it("addColumn with default and unique", () => {
    const m: SchemaMutation = {
      kind: "addColumn",
      table: "post",
      column: { name: "slug", type: "text", default: "draft", unique: true },
    };
    expect(buildMutationDDL(m)).toBe(
      `ALTER TABLE "post" ADD COLUMN IF NOT EXISTS "slug" text DEFAULT 'draft' UNIQUE;`,
    );
  });

  it("addColumn rejects reserved column name", () => {
    const m: SchemaMutation = {
      kind: "addColumn",
      table: "post",
      column: { name: "id", type: "uuid" },
    };
    expect(() => buildMutationDDL(m)).toThrow();
  });

  it("addColumn rejects invalid type", () => {
    const m: SchemaMutation = {
      kind: "addColumn",
      table: "post",
      column: { name: "title", type: "wat" },
    };
    expect(() => buildMutationDDL(m)).toThrow('Invalid column type: "wat"');
  });

  it("dropColumn", () => {
    const m: SchemaMutation = { kind: "dropColumn", table: "post", column: "title" };
    expect(buildMutationDDL(m)).toBe(
      'ALTER TABLE "post" DROP COLUMN IF EXISTS "title";',
    );
  });

  it("dropColumn rejects reserved columns id/created_at", () => {
    expect(() =>
      buildMutationDDL({ kind: "dropColumn", table: "post", column: "id" }),
    ).toThrow('Column "id" is reserved and cannot be dropped');
    expect(() =>
      buildMutationDDL({ kind: "dropColumn", table: "post", column: "created_at" }),
    ).toThrow('Column "created_at" is reserved and cannot be dropped');
  });

  it("alterColumn: type only", () => {
    const m: SchemaMutation = {
      kind: "alterColumn",
      table: "post",
      column: "title",
      changes: { type: "text" },
    };
    expect(buildMutationDDL(m)).toBe(
      'ALTER TABLE "post" ALTER COLUMN "title" TYPE text;',
    );
  });

  it("alterColumn: nullable true/false", () => {
    expect(
      buildMutationDDL({
        kind: "alterColumn",
        table: "post",
        column: "title",
        changes: { nullable: false },
      }),
    ).toBe('ALTER TABLE "post" ALTER COLUMN "title" SET NOT NULL;');
    expect(
      buildMutationDDL({
        kind: "alterColumn",
        table: "post",
        column: "title",
        changes: { nullable: true },
      }),
    ).toBe('ALTER TABLE "post" ALTER COLUMN "title" DROP NOT NULL;');
  });

  it("alterColumn: default null (drop) vs string (set)", () => {
    expect(
      buildMutationDDL({
        kind: "alterColumn",
        table: "post",
        column: "title",
        changes: { default: null },
      }),
    ).toBe('ALTER TABLE "post" ALTER COLUMN "title" DROP DEFAULT;');
    expect(
      buildMutationDDL({
        kind: "alterColumn",
        table: "post",
        column: "title",
        changes: { default: "draft" },
      }),
    ).toBe(`ALTER TABLE "post" ALTER COLUMN "title" SET DEFAULT 'draft';`);
  });

  it("alterColumn: multi-change ordering type, nullable, default", () => {
    const m: SchemaMutation = {
      kind: "alterColumn",
      table: "post",
      column: "title",
      changes: { type: "text", nullable: false, default: "draft" },
    };
    expect(buildMutationDDL(m)).toBe(
      [
        'ALTER TABLE "post" ALTER COLUMN "title" TYPE text;',
        'ALTER TABLE "post" ALTER COLUMN "title" SET NOT NULL;',
        `ALTER TABLE "post" ALTER COLUMN "title" SET DEFAULT 'draft';`,
      ].join("\n"),
    );
  });

  it("alterColumn: no changes throws", () => {
    expect(() =>
      buildMutationDDL({ kind: "alterColumn", table: "post", column: "title", changes: {} }),
    ).toThrow("alterColumn: no changes specified");
  });

  it("alterColumn rejects reserved columns id/created_at", () => {
    expect(() =>
      buildMutationDDL({
        kind: "alterColumn",
        table: "post",
        column: "id",
        changes: { nullable: true },
      }),
    ).toThrow('Column "id" is reserved and cannot be altered');
    expect(() =>
      buildMutationDDL({
        kind: "alterColumn",
        table: "post",
        column: "created_at",
        changes: { nullable: true },
      }),
    ).toThrow('Column "created_at" is reserved and cannot be altered');
  });

  it("alterColumn rejects invalid type", () => {
    expect(() =>
      buildMutationDDL({
        kind: "alterColumn",
        table: "post",
        column: "title",
        changes: { type: "wat" },
      }),
    ).toThrow('Invalid column type: "wat"');
  });

  it("renameColumn", () => {
    const m: SchemaMutation = {
      kind: "renameColumn",
      table: "post",
      from: "title",
      to: "heading",
    };
    expect(buildMutationDDL(m)).toBe(
      'ALTER TABLE "post" RENAME COLUMN "title" TO "heading";',
    );
  });

  it("renameColumn rejects reserved columns id/created_at", () => {
    expect(() =>
      buildMutationDDL({ kind: "renameColumn", table: "post", from: "id", to: "uid" }),
    ).toThrow('Column "id" is reserved and cannot be renamed');
    expect(() =>
      buildMutationDDL({
        kind: "renameColumn",
        table: "post",
        from: "created_at",
        to: "made_at",
      }),
    ).toThrow('Column "created_at" is reserved and cannot be renamed');
  });

  it("createIndex with default name derivation", () => {
    const m: SchemaMutation = {
      kind: "createIndex",
      table: "post",
      columns: ["slug"],
      unique: true,
    };
    expect(buildMutationDDL(m)).toBe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "idx_post_slug" ON "post" ("slug");',
    );
  });

  it("createIndex non-unique with explicit name and multiple columns", () => {
    const m: SchemaMutation = {
      kind: "createIndex",
      table: "post",
      columns: ["author_id", "slug"],
      name: "my_idx",
    };
    expect(buildMutationDDL(m)).toBe(
      'CREATE INDEX IF NOT EXISTS "my_idx" ON "post" ("author_id", "slug");',
    );
  });

  it("createIndex requires at least one column", () => {
    expect(() =>
      buildMutationDDL({ kind: "createIndex", table: "post", columns: [] }),
    ).toThrow("createIndex: no columns");
  });

  it("dropIndex", () => {
    const m: SchemaMutation = { kind: "dropIndex", name: "idx_post_slug" };
    expect(buildMutationDDL(m)).toBe('DROP INDEX IF EXISTS "idx_post_slug";');
  });

  it("setRls enable/disable", () => {
    expect(buildMutationDDL({ kind: "setRls", table: "post", enabled: true })).toBe(
      'ALTER TABLE "post" ENABLE ROW LEVEL SECURITY;',
    );
    expect(buildMutationDDL({ kind: "setRls", table: "post", enabled: false })).toBe(
      'ALTER TABLE "post" DISABLE ROW LEVEL SECURITY;',
    );
  });

  it("rejects invalid identifiers across kinds", () => {
    expect(() =>
      buildMutationDDL({ kind: "addColumn", table: "a b", column: { name: "x", type: "text" } }),
    ).toThrow('Invalid table name: "a b"');
    expect(() =>
      buildMutationDDL({ kind: "addColumn", table: "post", column: { name: "a b", type: "text" } }),
    ).toThrow('Invalid column name: "a b"');
    expect(() =>
      buildMutationDDL({ kind: "dropIndex", name: "a b" }),
    ).toThrow('Invalid index name: "a b"');
  });
});

describe("applyMutationToSeed", () => {
  const post: TableDef = {
    name: "post",
    columns: [{ name: "title", type: "text", nullable: false }],
  };
  const seed: TableDef[] = [post];

  it("does not mutate the input array or its tables", () => {
    const before = JSON.stringify(seed);
    applyMutationToSeed(seed, { kind: "dropTable", table: "post" });
    expect(JSON.stringify(seed)).toBe(before);
  });

  describe("createTable", () => {
    it("appends a new table", () => {
      const m: SchemaMutation = {
        kind: "createTable",
        table: { name: "comment", columns: [{ name: "body", type: "text" }] },
      };
      const next = applyMutationToSeed(seed, m);
      expect(next).not.toBe(seed);
      expect(next.map((t) => t.name)).toEqual(["post", "comment"]);
    });

    it("throws when the table already exists", () => {
      const m: SchemaMutation = { kind: "createTable", table: { name: "post", columns: [] } };
      expect(() => applyMutationToSeed(seed, m)).toThrow('Table "post" already exists');
    });

    it("validates the new table (bad identifier/type)", () => {
      expect(() =>
        applyMutationToSeed(seed, {
          kind: "createTable",
          table: { name: "a b", columns: [] },
        }),
      ).toThrow('Invalid table name: "a b"');
      expect(() =>
        applyMutationToSeed(seed, {
          kind: "createTable",
          table: { name: "comment", columns: [{ name: "x", type: "not-a-type" }] },
        }),
      ).toThrow('Invalid column type: "not-a-type"');
    });
  });

  describe("dropTable", () => {
    it("removes the table by name", () => {
      const next = applyMutationToSeed(seed, { kind: "dropTable", table: "post" });
      expect(next).toEqual([]);
    });

    it("throws when the table is absent", () => {
      expect(() =>
        applyMutationToSeed(seed, { kind: "dropTable", table: "missing" }),
      ).toThrow('Table "missing" not found');
    });
  });

  describe("addColumn", () => {
    it("appends a column to the named table", () => {
      const m: SchemaMutation = {
        kind: "addColumn",
        table: "post",
        column: { name: "slug", type: "text" },
      };
      const next = applyMutationToSeed(seed, m);
      expect(next[0].columns.map((c) => c.name)).toEqual(["title", "slug"]);
      // original untouched
      expect(seed[0].columns.map((c) => c.name)).toEqual(["title"]);
    });

    it("throws when the table is absent", () => {
      expect(() =>
        applyMutationToSeed(seed, {
          kind: "addColumn",
          table: "missing",
          column: { name: "x", type: "text" },
        }),
      ).toThrow('Table "missing" not found');
    });

    it("rejects a reserved column name", () => {
      expect(() =>
        applyMutationToSeed(seed, {
          kind: "addColumn",
          table: "post",
          column: { name: "id", type: "uuid" },
        }),
      ).toThrow();
    });

    it("throws when the column already exists", () => {
      expect(() =>
        applyMutationToSeed(seed, {
          kind: "addColumn",
          table: "post",
          column: { name: "title", type: "text" },
        }),
      ).toThrow('Column "title" already exists');
    });
  });

  describe("dropColumn", () => {
    it("removes the column", () => {
      const withTwoCols: TableDef[] = [
        { name: "post", columns: [{ name: "title", type: "text" }, { name: "slug", type: "text" }] },
      ];
      const next = applyMutationToSeed(withTwoCols, { kind: "dropColumn", table: "post", column: "slug" });
      expect(next[0].columns.map((c) => c.name)).toEqual(["title"]);
    });

    it("rejects dropping a reserved column", () => {
      expect(() =>
        applyMutationToSeed(seed, { kind: "dropColumn", table: "post", column: "id" }),
      ).toThrow('Column "id" is reserved and cannot be dropped');
      expect(() =>
        applyMutationToSeed(seed, { kind: "dropColumn", table: "post", column: "created_at" }),
      ).toThrow('Column "created_at" is reserved and cannot be dropped');
    });

    it("throws when the table is absent", () => {
      expect(() =>
        applyMutationToSeed(seed, { kind: "dropColumn", table: "missing", column: "title" }),
      ).toThrow('Table "missing" not found');
    });

    it("throws when the column is absent", () => {
      expect(() =>
        applyMutationToSeed(seed, { kind: "dropColumn", table: "post", column: "missing" }),
      ).toThrow('Column "missing" not found');
    });
  });

  describe("alterColumn", () => {
    it("applies type, nullable, and default changes", () => {
      const next = applyMutationToSeed(seed, {
        kind: "alterColumn",
        table: "post",
        column: "title",
        changes: { type: "int", nullable: true, default: "0" },
      });
      const col = next[0].columns[0];
      expect(col.type).toBe("int");
      expect(col.nullable).toBe(true);
      expect(col.default).toBe("0");
    });

    it("clears the default when changes.default is null", () => {
      const withDefault: TableDef[] = [
        { name: "post", columns: [{ name: "title", type: "text", default: "untitled" }] },
      ];
      const next = applyMutationToSeed(withDefault, {
        kind: "alterColumn",
        table: "post",
        column: "title",
        changes: { default: null },
      });
      expect(next[0].columns[0].default).toBeUndefined();
    });

    it("rejects altering a reserved column", () => {
      expect(() =>
        applyMutationToSeed(seed, {
          kind: "alterColumn",
          table: "post",
          column: "id",
          changes: { nullable: true },
        }),
      ).toThrow('Column "id" is reserved and cannot be altered');
    });

    it("throws when the table or column is absent", () => {
      expect(() =>
        applyMutationToSeed(seed, {
          kind: "alterColumn",
          table: "missing",
          column: "title",
          changes: { nullable: true },
        }),
      ).toThrow('Table "missing" not found');
      expect(() =>
        applyMutationToSeed(seed, {
          kind: "alterColumn",
          table: "post",
          column: "missing",
          changes: { nullable: true },
        }),
      ).toThrow('Column "missing" not found');
    });
  });

  describe("renameColumn", () => {
    it("renames the column", () => {
      const next = applyMutationToSeed(seed, {
        kind: "renameColumn",
        table: "post",
        from: "title",
        to: "heading",
      });
      expect(next[0].columns.map((c) => c.name)).toEqual(["heading"]);
    });

    it("rejects renaming a reserved column", () => {
      expect(() =>
        applyMutationToSeed(seed, {
          kind: "renameColumn",
          table: "post",
          from: "id",
          to: "uid",
        }),
      ).toThrow('Column "id" is reserved and cannot be renamed');
    });

    it("throws when the target name already exists", () => {
      const withTwoCols: TableDef[] = [
        { name: "post", columns: [{ name: "title", type: "text" }, { name: "slug", type: "text" }] },
      ];
      expect(() =>
        applyMutationToSeed(withTwoCols, {
          kind: "renameColumn",
          table: "post",
          from: "title",
          to: "slug",
        }),
      ).toThrow('Column "slug" already exists');
    });

    it("throws when the table or source column is absent", () => {
      expect(() =>
        applyMutationToSeed(seed, {
          kind: "renameColumn",
          table: "missing",
          from: "title",
          to: "heading",
        }),
      ).toThrow('Table "missing" not found');
      expect(() =>
        applyMutationToSeed(seed, {
          kind: "renameColumn",
          table: "post",
          from: "missing",
          to: "heading",
        }),
      ).toThrow('Column "missing" not found');
    });
  });

  describe("createIndex / dropIndex / setRls — draft-unsupported", () => {
    it("createIndex throws the provisioned-only message", () => {
      expect(() =>
        applyMutationToSeed(seed, {
          kind: "createIndex",
          table: "post",
          columns: ["title"],
        }),
      ).toThrow("createIndex is only supported on a provisioned database");
    });

    it("dropIndex throws the provisioned-only message", () => {
      expect(() =>
        applyMutationToSeed(seed, { kind: "dropIndex", name: "idx_post_title" }),
      ).toThrow("dropIndex is only supported on a provisioned database");
    });

    it("setRls throws the provisioned-only message", () => {
      expect(() =>
        applyMutationToSeed(seed, { kind: "setRls", table: "post", enabled: true }),
      ).toThrow("setRls is only supported on a provisioned database");
    });
  });

  describe("liveTypeToEditorType", () => {
    it.each([
      ["integer", "int"],
      ["int", "int"],
      ["int4", "int"],
      ["bigint", "bigint"],
      ["int8", "bigint"],
      ["text", "text"],
      ["character varying", "text"],
      ["varchar", "text"],
      ["boolean", "boolean"],
      ["bool", "boolean"],
      ["uuid", "uuid"],
      ["timestamp with time zone", "timestamptz"],
      ["timestamptz", "timestamptz"],
      ["jsonb", "jsonb"],
      ["numeric", "numeric"],
      ["decimal", "numeric"],
    ])("maps %s -> %s", (pgType, expected) => {
      expect(liveTypeToEditorType(pgType)).toBe(expected);
    });

    it("returns unknown types unchanged", () => {
      expect(liveTypeToEditorType("inet")).toBe("inet");
      expect(liveTypeToEditorType("timestamp without time zone")).toBe(
        "timestamp without time zone",
      );
      expect(liveTypeToEditorType("date")).toBe("date");
      expect(liveTypeToEditorType("json")).toBe("json");
    });

    it("is case-insensitive and trims whitespace", () => {
      expect(liveTypeToEditorType("INTEGER")).toBe("int");
      expect(liveTypeToEditorType("  integer  ")).toBe("int");
      expect(liveTypeToEditorType("Boolean")).toBe("boolean");
    });

    it("never throws on garbage input", () => {
      expect(() => liveTypeToEditorType("")).not.toThrow();
      expect(liveTypeToEditorType("")).toBe("");
    });
  });
});
