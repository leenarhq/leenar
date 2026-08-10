import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase", () => ({
  executeSql: vi.fn(),
  MAX_ROWS: 1000,
}));

import { executeSql, MAX_ROWS } from "./supabase";
import { selectRows } from "./rows";

const emptyResult = {
  columns: [] as string[],
  rows: [] as unknown[][],
  rowCount: 0,
  truncated: false,
};

describe("selectRows", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (executeSql as any) = vi.fn(async () => emptyResult);
  });

  it("builds a qi'd SELECT with default limit/offset and no ORDER BY", async () => {
    await selectRows("tok", "abc-ref", "users", { limit: 50, offset: 0 });
    expect(executeSql).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      'SELECT * FROM public."users" LIMIT 50 OFFSET 0',
      "read",
    );
  });

  it("quotes a table name containing a double quote", async () => {
    await selectRows("tok", "abc-ref", 'weird"table', { limit: 10, offset: 0 });
    expect(executeSql).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      'SELECT * FROM public."weird""table" LIMIT 10 OFFSET 0',
      "read",
    );
  });

  it("adds a qi'd ORDER BY clause with ASC direction", async () => {
    await selectRows("tok", "abc-ref", "users", {
      limit: 10,
      offset: 0,
      orderBy: "created_at",
      orderDir: "asc",
    });
    expect(executeSql).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      'SELECT * FROM public."users" ORDER BY "created_at" ASC LIMIT 10 OFFSET 0',
      "read",
    );
  });

  it("adds a qi'd ORDER BY clause with DESC direction", async () => {
    await selectRows("tok", "abc-ref", "users", {
      limit: 10,
      offset: 0,
      orderBy: "created_at",
      orderDir: "desc",
    });
    expect(executeSql).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      'SELECT * FROM public."users" ORDER BY "created_at" DESC LIMIT 10 OFFSET 0',
      "read",
    );
  });

  it("clamps a limit over MAX_ROWS down to MAX_ROWS", async () => {
    await selectRows("tok", "abc-ref", "users", {
      limit: MAX_ROWS + 500,
      offset: 0,
    });
    expect(executeSql).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      `SELECT * FROM public."users" LIMIT ${MAX_ROWS} OFFSET 0`,
      "read",
    );
  });

  it("clamps a limit of 0 or negative up to 1", async () => {
    await selectRows("tok", "abc-ref", "users", { limit: 0, offset: 0 });
    expect(executeSql).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      'SELECT * FROM public."users" LIMIT 1 OFFSET 0',
      "read",
    );
  });

  it("clamps a negative offset to 0", async () => {
    await selectRows("tok", "abc-ref", "users", { limit: 10, offset: -5 });
    expect(executeSql).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      'SELECT * FROM public."users" LIMIT 10 OFFSET 0',
      "read",
    );
  });

  it("truncates non-integer limit/offset via Math.trunc", async () => {
    await selectRows("tok", "abc-ref", "users", { limit: 10.9, offset: 2.9 });
    expect(executeSql).toHaveBeenCalledWith(
      "tok",
      "abc-ref",
      'SELECT * FROM public."users" LIMIT 10 OFFSET 2',
      "read",
    );
  });

  it("returns the RowsPage shape spread from executeSql plus limit/offset", async () => {
    (executeSql as any) = vi.fn(async () => ({
      columns: ["id", "name"],
      rows: [[1, "a"]],
      rowCount: 1,
      truncated: false,
    }));
    const page = await selectRows("tok", "abc-ref", "users", {
      limit: 25,
      offset: 5,
    });
    expect(page).toEqual({
      columns: ["id", "name"],
      rows: [[1, "a"]],
      rowCount: 1,
      truncated: false,
      limit: 25,
      offset: 5,
    });
  });
});
