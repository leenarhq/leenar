import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils", () => ({ sb: vi.fn() }));

import { listSnippets, createSnippet, deleteSnippet } from "./snippets";
import * as utils from "../utils";

const USER_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const PROJECT_ID = "p1";
const NODE_ID = "n1";

function jsonRes(body: unknown, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body } as Response;
}

function makeEnv() {
  return {} as any;
}

describe("listSnippets", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps rows and filters by user/project/node, ordered newest first", async () => {
    (utils.sb as any).mockResolvedValue(
      jsonRes([
        { id: "s1", name: "count users", sql: "select count(*) from users", created_at: "2026-01-01T00:00:00Z" },
      ]),
    );

    const result = await listSnippets(makeEnv(), USER_ID, PROJECT_ID, NODE_ID);

    expect(result).toEqual([
      { id: "s1", name: "count users", sql: "select count(*) from users", createdAt: "2026-01-01T00:00:00Z" },
    ]);
    const [, path] = (utils.sb as any).mock.calls[0];
    expect(path).toContain(`user_id=eq.${USER_ID}`);
    expect(path).toContain(`project_id=eq.${PROJECT_ID}`);
    expect(path).toContain(`node_id=eq.${NODE_ID}`);
    expect(path).toContain("order=created_at.desc");
  });

  it("throws 'Failed to fetch snippets' when sb() is not ok", async () => {
    (utils.sb as any).mockResolvedValue(jsonRes(null, false, 500));
    await expect(listSnippets(makeEnv(), USER_ID, PROJECT_ID, NODE_ID)).rejects.toThrow(
      "Failed to fetch snippets",
    );
  });
});

describe("createSnippet", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts with the given user_id/project_id/node_id and returns the mapped row", async () => {
    (utils.sb as any).mockResolvedValue(
      jsonRes([{ id: "s2", name: "my snippet", sql: "select 1", created_at: "2026-01-02T00:00:00Z" }]),
    );

    const result = await createSnippet(makeEnv(), USER_ID, PROJECT_ID, NODE_ID, "my snippet", "select 1");

    expect(result).toEqual({ id: "s2", name: "my snippet", sql: "select 1", createdAt: "2026-01-02T00:00:00Z" });
    const [, path, init] = (utils.sb as any).mock.calls[0];
    expect(path).toBe("db_query_snippets");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ user_id: USER_ID, project_id: PROJECT_ID, node_id: NODE_ID, name: "my snippet", sql: "select 1" });
  });

  it("throws 'Failed to save snippet' when sb() is not ok", async () => {
    (utils.sb as any).mockResolvedValue(jsonRes(null, false, 500));
    await expect(
      createSnippet(makeEnv(), USER_ID, PROJECT_ID, NODE_ID, "n", "select 1"),
    ).rejects.toThrow("Failed to save snippet");
  });
});

describe("deleteSnippet", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filters by both id and user_id", async () => {
    (utils.sb as any).mockResolvedValue(jsonRes({}, true, 200));

    await deleteSnippet(makeEnv(), USER_ID, "s1");

    const [, path, init] = (utils.sb as any).mock.calls[0];
    expect(path).toContain("id=eq.s1");
    expect(path).toContain(`user_id=eq.${USER_ID}`);
    expect(init.method).toBe("DELETE");
  });

  it("throws 'Failed to delete snippet' when sb() is not ok", async () => {
    (utils.sb as any).mockResolvedValue(jsonRes(null, false, 500));
    await expect(deleteSnippet(makeEnv(), USER_ID, "s1")).rejects.toThrow("Failed to delete snippet");
  });
});
