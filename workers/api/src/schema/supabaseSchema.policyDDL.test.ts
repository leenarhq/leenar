import { describe, it, expect } from "vitest";
import { buildMutationDDL, applyMutationToSeed } from "./supabaseSchema";
import type { SchemaMutation, TableDef } from "./supabaseSchema";

describe("buildMutationDDL — createPolicy", () => {
  it("SELECT command with roles + using", () => {
    const m: SchemaMutation = {
      kind: "createPolicy",
      table: "post",
      name: "select_own",
      command: "SELECT",
      roles: ["authenticated"],
      using: "auth.uid() = user_id",
    };
    const out = buildMutationDDL(m);
    expect(out).toContain('CREATE POLICY "select_own" ON "post"');
    expect(out).toContain("FOR SELECT");
    expect(out).toContain("TO authenticated");
    expect(out).toContain("USING (auth.uid() = user_id)");
    expect(out).not.toContain("WITH CHECK");
  });

  it("ALL command with withCheck, no roles -> TO public", () => {
    const m: SchemaMutation = {
      kind: "createPolicy",
      table: "post",
      name: "owner_all",
      command: "ALL",
      withCheck: "auth.uid() = owner",
    };
    const out = buildMutationDDL(m);
    expect(out).toContain("FOR ALL");
    expect(out).toContain("WITH CHECK (auth.uid() = owner)");
    expect(out).toContain("TO public");
    expect(out).not.toContain("USING (");
  });

  it("empty roles array -> TO public", () => {
    const m: SchemaMutation = {
      kind: "createPolicy",
      table: "post",
      name: "p",
      command: "SELECT",
      roles: [],
    };
    expect(buildMutationDDL(m)).toContain("TO public");
  });

  it("two roles -> comma joined, bare identifiers", () => {
    const m: SchemaMutation = {
      kind: "createPolicy",
      table: "post",
      name: "p",
      command: "SELECT",
      roles: ["a", "b"],
    };
    expect(buildMutationDDL(m)).toContain("TO a, b");
  });

  it("neither using nor withCheck is permitted", () => {
    const m: SchemaMutation = {
      kind: "createPolicy",
      table: "post",
      name: "p",
      command: "DELETE",
    };
    const out = buildMutationDDL(m);
    expect(out).toContain("FOR DELETE");
    expect(out).not.toContain("USING (");
    expect(out).not.toContain("WITH CHECK");
  });

  it("rejects invalid command", () => {
    const m = {
      kind: "createPolicy",
      table: "post",
      name: "p",
      command: "FOO",
    } as unknown as SchemaMutation;
    expect(() => buildMutationDDL(m)).toThrow('Invalid policy command: "FOO"');
  });

  it("rejects invalid role", () => {
    const m: SchemaMutation = {
      kind: "createPolicy",
      table: "post",
      name: "p",
      command: "SELECT",
      roles: ["bad role"],
    };
    expect(() => buildMutationDDL(m)).toThrow('Invalid role: "bad role"');
  });

  it("rejects invalid policy name", () => {
    const m: SchemaMutation = {
      kind: "createPolicy",
      table: "post",
      name: "bad name",
      command: "SELECT",
    };
    expect(() => buildMutationDDL(m)).toThrow('Invalid policy name: "bad name"');
  });

  it("rejects invalid table name", () => {
    const m: SchemaMutation = {
      kind: "createPolicy",
      table: "bad table",
      name: "p",
      command: "SELECT",
    };
    expect(() => buildMutationDDL(m)).toThrow('Invalid table name: "bad table"');
  });

  it("rejects using containing a semicolon", () => {
    const m: SchemaMutation = {
      kind: "createPolicy",
      table: "post",
      name: "p",
      command: "SELECT",
      using: "auth.uid() = user_id; DROP TABLE post",
    };
    expect(() => buildMutationDDL(m)).toThrow();
  });

  it("rejects withCheck containing a newline", () => {
    const m: SchemaMutation = {
      kind: "createPolicy",
      table: "post",
      name: "p",
      command: "INSERT",
      withCheck: "auth.uid() = owner\nDROP TABLE post",
    };
    expect(() => buildMutationDDL(m)).toThrow();
  });

  it("rejects withCheck containing a carriage return", () => {
    const m: SchemaMutation = {
      kind: "createPolicy",
      table: "post",
      name: "p",
      command: "INSERT",
      withCheck: "auth.uid() = owner\r",
    };
    expect(() => buildMutationDDL(m)).toThrow();
  });
});

describe("buildMutationDDL — dropPolicy", () => {
  it("emits DROP POLICY IF EXISTS", () => {
    const m: SchemaMutation = { kind: "dropPolicy", table: "t", name: "p" };
    expect(buildMutationDDL(m)).toBe('DROP POLICY IF EXISTS "p" ON "t";');
  });

  it("rejects invalid policy name", () => {
    const m: SchemaMutation = { kind: "dropPolicy", table: "t", name: "bad name" };
    expect(() => buildMutationDDL(m)).toThrow('Invalid policy name: "bad name"');
  });

  it("rejects invalid table name", () => {
    const m: SchemaMutation = { kind: "dropPolicy", table: "bad table", name: "p" };
    expect(() => buildMutationDDL(m)).toThrow('Invalid table name: "bad table"');
  });
});

describe("applyMutationToSeed — policy kinds throw", () => {
  const tables: TableDef[] = [{ name: "post", columns: [] }];

  it("createPolicy throws (no seed representation)", () => {
    const m: SchemaMutation = {
      kind: "createPolicy",
      table: "post",
      name: "p",
      command: "SELECT",
    };
    expect(() => applyMutationToSeed(tables, m)).toThrow();
  });

  it("dropPolicy throws (no seed representation)", () => {
    const m: SchemaMutation = { kind: "dropPolicy", table: "post", name: "p" };
    expect(() => applyMutationToSeed(tables, m)).toThrow();
  });
});
