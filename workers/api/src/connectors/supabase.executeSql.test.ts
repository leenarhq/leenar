import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executeSql,
  runQuery,
  splitSqlStatements,
  assertReadOnlyStatement,
  MAX_ROWS,
} from "./supabase";

const okJson = (body: unknown) =>
  ({ ok: true, json: async () => body }) as unknown as Response;

describe("executeSql", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("read mode wraps SQL in a read-only transaction", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson([]));
    await executeSql("tok", "abc-ref", "select 1", "read");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.query).toBe(
      "BEGIN; SET TRANSACTION READ ONLY; select 1; ROLLBACK;",
    );
  });

  it("write mode sends raw SQL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson([]));
    await executeSql("tok", "abc-ref", "insert into t values (1)", "write");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.query).toBe("insert into t values (1)");
  });

  it("normalizes rows to columns+rows and caps at MAX_ROWS", async () => {
    const many = Array.from({ length: MAX_ROWS + 5 }, (_, i) => ({ id: i }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson(many));
    const res = await executeSql("tok", "abc-ref", "select id from t", "read");
    expect(res.columns).toEqual(["id"]);
    expect(res.rows.length).toBe(MAX_ROWS);
    expect(res.truncated).toBe(true);
    expect(res.rows[0]).toEqual([0]);
  });

  it("rejects an invalid ref", async () => {
    await expect(executeSql("tok", "bad ref!", "select 1", "read")).rejects.toThrow(
      /Invalid Supabase project ref/,
    );
  });

  it("redacts the bearer token from a thrown error (M3)", async () => {
    const SECRET_TOKEN = "sbp_supersecret_bearer_token_1234567890";
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({
        message: `connection failed using Authorization: Bearer ${SECRET_TOKEN}`,
      }),
    } as unknown as Response);

    let thrown: unknown;
    try {
      await runQuery(SECRET_TOKEN, "abc-ref", "select 1");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toContain(SECRET_TOKEN);
  });
});

// The read-only wrapper is string concatenation and `SET TRANSACTION READ ONLY`
// binds to the current transaction only, so caller SQL that closes it escapes
// into autocommit read-write. `mode:"read"` is also the branch isDestructiveCall
// does NOT gate, so an escape here executes with no confirmation at all.
describe("read mode is single-statement gated", () => {
  beforeEach(() => vi.restoreAllMocks());

  const noFetch = () =>
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("fetch must not be reached — the guard runs first");
    });

  it("rejects a ROLLBACK; escape before it reaches the network", async () => {
    const fetchMock = noFetch();
    await expect(
      executeSql("tok", "abc-ref", "ROLLBACK; DROP TABLE public.users; BEGIN", "read"),
    ).rejects.toThrow(/exactly one statement/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a COMMIT; escape", async () => {
    noFetch();
    await expect(
      executeSql("tok", "abc-ref", "COMMIT; DELETE FROM public.users", "read"),
    ).rejects.toThrow(/exactly one statement/);
  });

  it("rejects a lone write statement", async () => {
    noFetch();
    await expect(
      executeSql("tok", "abc-ref", "DELETE FROM public.users", "read"),
    ).rejects.toThrow(/SELECT \/ WITH \/ EXPLAIN/);
  });

  it("still runs a plain read, trailing semicolon and all", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson([]));
    await executeSql("tok", "abc-ref", "SELECT 1;", "read");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.query).toBe("BEGIN; SET TRANSACTION READ ONLY; SELECT 1;; ROLLBACK;");
  });

  it("leaves write mode alone — it is gated by confirmation, not by shape", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson([]));
    await executeSql("tok", "abc-ref", "DELETE FROM t; VACUUM;", "write");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.query).toBe("DELETE FROM t; VACUUM;");
  });
});

// Each case here defeats one of the two obvious regex-strip implementations.
// They are the reason splitSqlStatements is a lexer.
describe("splitSqlStatements", () => {
  it("keeps a ; inside a string literal out of the split", () => {
    expect(splitSqlStatements("SELECT 'a;b'")).toHaveLength(1);
  });

  it("does not lose a real ; to a ;-bearing string literal (strip-comments-first trap)", () => {
    // `--` here is DATA, not a comment: a comments-first strip would eat
    // `--' ; DROP …` and leave a lone innocent SELECT.
    expect(splitSqlStatements("SELECT '--' ; DROP TABLE t")).toHaveLength(2);
  });

  it("does not lose a real ; to a quote inside a comment (strip-literals-first trap)", () => {
    // Both apostrophes are inside line comments, so the `;` is top level. A
    // literals-first strip would pair them and swallow the statement between.
    expect(
      splitSqlStatements("SELECT 1 --'\n; DROP TABLE t --'"),
    ).toHaveLength(2);
  });

  it("handles '' escapes, nested block comments and dollar-quoted bodies", () => {
    expect(splitSqlStatements("SELECT 'it''s; fine'")).toHaveLength(1);
    expect(splitSqlStatements("SELECT 1 /* a /* b ; */ c */ ; SELECT 2")).toHaveLength(2);
    expect(splitSqlStatements("SELECT $$a; b$$")).toHaveLength(1);
    expect(splitSqlStatements("SELECT $tag$a; b$tag$ ; SELECT 2")).toHaveLength(2);
  });

  it("keeps a ; visible when $ merely continues an identifier", () => {
    // `a$b` is one identifier; the `$` opens no dollar-quote, so the `;` is real.
    expect(splitSqlStatements("SELECT a$b$; DROP TABLE t; $b$")).toHaveLength(3);
  });

  it("treats a backslash as ordinary, erring toward over-counting", () => {
    // standard_conforming_strings=on. Mis-lexing an E-string this way can only
    // end a literal early and expose more statements — never hide one.
    expect(splitSqlStatements("SELECT E'\\'; DROP TABLE t; --'").length).toBeGreaterThan(1);
  });

  it("accepts a leading paren and a leading CTE", () => {
    expect(() => assertReadOnlyStatement("(SELECT 1) UNION (SELECT 2)")).not.toThrow();
    expect(() => assertReadOnlyStatement("WITH x AS (SELECT 1) SELECT * FROM x")).not.toThrow();
  });

  it("rejects empty input", () => {
    expect(() => assertReadOnlyStatement("   -- nothing\n")).toThrow(/No SQL statement/);
  });
});
