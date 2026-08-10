import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase", () => ({
  executeSql: vi.fn(),
  MAX_ROWS: 1000,
}));

import { executeSql } from "./supabase";
import { insertRow, updateRowByPk, deleteRowByPk } from "./rows";

const emptyResult = {
  columns: [] as string[],
  rows: [] as unknown[][],
  rowCount: 0,
  truncated: false,
};

describe("insertRow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (executeSql as any) = vi.fn(async () => emptyResult);
  });

  it("builds an INSERT with qi'd columns and toSqlLiteral'd values, in write mode, RETURNING *", async () => {
    await insertRow("tok", "abc-ref", "t", { a: 1, b: "x" });
    expect(executeSql).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      'INSERT INTO public."t" ("a", "b") VALUES (1, \'x\') RETURNING *;',
      "write",
    );
  });

  it("escapes a single quote in a string value (O'Brien)", async () => {
    await insertRow("tok", "abc-ref", "t", { name: "O'Brien" });
    expect(executeSql).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      "INSERT INTO public.\"t\" (\"name\") VALUES ('O''Brien') RETURNING *;",
      "write",
    );
  });

  it("keeps an injection-attempt string value as a single escaped literal (no second statement)", async () => {
    const evil = "'); DROP TABLE x;--";
    await insertRow("tok", "abc-ref", "t", { name: evil });
    const sql: string = (executeSql as any).mock.calls[0][2];
    // The whole payload — including its own embedded quote/semicolons —
    // must survive as ONE escaped literal token: '''); DROP TABLE x;--'.
    // Assert the exact built statement so there's no ambiguity about where
    // the literal starts/ends, and that only the builder's own trailing `;`
    // terminates a statement (i.e. the escaped quote never closes the
    // literal early and lets "DROP TABLE x" become a second statement).
    expect(sql).toBe(
      "INSERT INTO public.\"t\" (\"name\") VALUES ('''); DROP TABLE x;--') RETURNING *;",
    );
  });

  it("quotes a table name containing a double quote", async () => {
    await insertRow("tok", "abc-ref", 'weird"table', { a: 1 });
    expect(executeSql).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      'INSERT INTO public."weird""table" ("a") VALUES (1) RETURNING *;',
      "write",
    );
  });

  it("throws on empty values, without calling executeSql", async () => {
    await expect(insertRow("tok", "abc-ref", "t", {})).rejects.toThrow(
      "insertRow: no values",
    );
    expect(executeSql).not.toHaveBeenCalled();
  });

  it("returns the QueryResult from executeSql", async () => {
    const result = {
      columns: ["id"],
      rows: [[1]],
      rowCount: 1,
      truncated: false,
    };
    (executeSql as any) = vi.fn(async () => result);
    await expect(insertRow("tok", "abc-ref", "t", { a: 1 })).resolves.toEqual(
      result,
    );
  });
});

describe("updateRowByPk", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (executeSql as any) = vi.fn(async () => emptyResult);
  });

  it("builds an UPDATE with SET + WHERE(pk), write mode, RETURNING *", async () => {
    await updateRowByPk("tok", "abc-ref", "t", { id: 5 }, { name: "x" });
    expect(executeSql).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      'UPDATE public."t" SET "name" = \'x\' WHERE "id" = 5 RETURNING *;',
      "write",
    );
  });

  it("AND-joins a composite pk in the WHERE clause", async () => {
    await updateRowByPk(
      "tok",
      "abc-ref",
      "t",
      { org_id: 1, user_id: 2 },
      { role: "admin" },
    );
    expect(executeSql).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      'UPDATE public."t" SET "role" = \'admin\' WHERE "org_id" = 1 AND "user_id" = 2 RETURNING *;',
      "write",
    );
  });

  it("emits IS NULL for a null pk value instead of = NULL", async () => {
    await updateRowByPk("tok", "abc-ref", "t", { id: null }, { name: "x" });
    expect(executeSql).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      'UPDATE public."t" SET "name" = \'x\' WHERE "id" IS NULL RETURNING *;',
      "write",
    );
  });

  it("comma-joins multiple SET columns", async () => {
    await updateRowByPk("tok", "abc-ref", "t", { id: 1 }, { a: 1, b: "y" });
    expect(executeSql).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      'UPDATE public."t" SET "a" = 1, "b" = \'y\' WHERE "id" = 1 RETURNING *;',
      "write",
    );
  });

  it("keeps an injection-attempt string value as a single escaped literal", async () => {
    const evil = "'); DROP TABLE x;--";
    await updateRowByPk("tok", "abc-ref", "t", { id: 1 }, { name: evil });
    const sql: string = (executeSql as any).mock.calls[0][2];
    expect(sql).toBe(
      'UPDATE public."t" SET "name" = \'\'\'); DROP TABLE x;--\' WHERE "id" = 1 RETURNING *;',
    );
  });

  it("throws on empty values, without calling executeSql", async () => {
    await expect(
      updateRowByPk("tok", "abc-ref", "t", { id: 1 }, {}),
    ).rejects.toThrow("updateRowByPk: no values");
    expect(executeSql).not.toHaveBeenCalled();
  });

  it("throws on empty pk, without calling executeSql", async () => {
    await expect(
      updateRowByPk("tok", "abc-ref", "t", {}, { name: "x" }),
    ).rejects.toThrow("updateRowByPk: empty primary key");
    expect(executeSql).not.toHaveBeenCalled();
  });

  it("returns the QueryResult from executeSql", async () => {
    const result = {
      columns: ["id"],
      rows: [[1]],
      rowCount: 1,
      truncated: false,
    };
    (executeSql as any) = vi.fn(async () => result);
    await expect(
      updateRowByPk("tok", "abc-ref", "t", { id: 1 }, { a: 1 }),
    ).resolves.toEqual(result);
  });
});

describe("deleteRowByPk", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (executeSql as any) = vi.fn(async () => emptyResult);
  });

  it("builds a DELETE with WHERE(pk), write mode, RETURNING *", async () => {
    await deleteRowByPk("tok", "abc-ref", "t", { id: 5 });
    expect(executeSql).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      'DELETE FROM public."t" WHERE "id" = 5 RETURNING *;',
      "write",
    );
  });

  it("AND-joins a composite pk in the WHERE clause", async () => {
    await deleteRowByPk("tok", "abc-ref", "t", { org_id: 1, user_id: 2 });
    expect(executeSql).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      'DELETE FROM public."t" WHERE "org_id" = 1 AND "user_id" = 2 RETURNING *;',
      "write",
    );
  });

  it("emits IS NULL for a null pk value instead of = NULL", async () => {
    await deleteRowByPk("tok", "abc-ref", "t", { id: null });
    expect(executeSql).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      'DELETE FROM public."t" WHERE "id" IS NULL RETURNING *;',
      "write",
    );
  });

  it("keeps an injection-attempt string pk value as a single escaped literal", async () => {
    const evil = "'); DROP TABLE x;--";
    await deleteRowByPk("tok", "abc-ref", "t", { name: evil });
    const sql: string = (executeSql as any).mock.calls[0][2];
    expect(sql).toBe(
      "DELETE FROM public.\"t\" WHERE \"name\" = '''); DROP TABLE x;--' RETURNING *;",
    );
  });

  it("throws on empty pk, without calling executeSql", async () => {
    await expect(deleteRowByPk("tok", "abc-ref", "t", {})).rejects.toThrow(
      "deleteRowByPk: empty primary key",
    );
    expect(executeSql).not.toHaveBeenCalled();
  });

  it("returns the QueryResult from executeSql", async () => {
    const result = {
      columns: ["id"],
      rows: [[1]],
      rowCount: 1,
      truncated: false,
    };
    (executeSql as any) = vi.fn(async () => result);
    await expect(
      deleteRowByPk("tok", "abc-ref", "t", { id: 1 }),
    ).resolves.toEqual(result);
  });
});
