import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeSql, runQuery, MAX_ROWS } from "./supabase";

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
