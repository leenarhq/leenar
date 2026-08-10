/**
 * Unit tests for refreshNodeSnapshot — the Phase 3 introspect->canvas
 * snapshot refresh primitive.
 *
 * refreshNodeSnapshot calls resolveSupabaseNode and introspectSchema as
 * SAME-MODULE bindings (both live in connectors/supabase.ts), so vi.mock on
 * "./supabase" cannot intercept those internal calls (self-mock only rebinds
 * the module's namespace object seen by external importers, not direct
 * intra-module references). Instead — matching the existing sibling test
 * files' conventions (supabase.resolveNode.test.ts, supabase.introspect.test.ts)
 * — we drive the REAL resolveSupabaseNode/introspectSchema via a fetch spy,
 * and only mock the genuine cross-module boundaries: getUserToken
 * (../utils) and commitCanvasTables (../canvasTables).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils")>();
  return {
    ...actual,
    getUserToken: vi.fn(async () => "tok"),
  };
});

vi.mock("../canvasTables", () => ({
  commitCanvasTables: vi.fn(async () => ({ projectRef: "abc-ref" })),
}));

import { refreshNodeSnapshot } from "./supabase";
import type { LiveSchema } from "./supabase";
import { getUserToken } from "../utils";
import { commitCanvasTables } from "../canvasTables";

const ENV = { SUPABASE_URL: "https://x", SUPABASE_SERVICE_ROLE_KEY: "k" } as any;
const USER_ID = "aabbccdd-0000-0000-0000-000000000001";
const PROJECT_ID = "12345678-1234-1234-1234-123456789012";
const NODE_ID = "aabbccdd-2222-2222-2222-000000000042";

const SAMPLE_SCHEMA: LiveSchema = {
  tables: [
    {
      name: "users",
      rlsEnabled: true,
      indexes: [],
      policies: [],
      columns: [
        {
          name: "id",
          dataType: "uuid",
          nullable: false,
          default: "gen_random_uuid()",
          isPrimaryKey: true,
          isUnique: true,
          isForeignKey: false,
        },
        {
          name: "created_at",
          dataType: "timestamptz",
          nullable: false,
          default: "now()",
          isPrimaryKey: false,
          isUnique: false,
          isForeignKey: false,
        },
        {
          name: "email",
          dataType: "text",
          nullable: false,
          default: null,
          isPrimaryKey: false,
          isUnique: true,
          isForeignKey: false,
        },
        {
          name: "age",
          dataType: "integer",
          nullable: true,
          default: null,
          isPrimaryKey: false,
          isUnique: false,
          isForeignKey: false,
        },
        {
          name: "meta",
          dataType: "jsonb",
          nullable: true,
          default: "'{}'",
          isPrimaryKey: false,
          isUnique: false,
          isForeignKey: false,
        },
        {
          name: "ip",
          dataType: "inet",
          nullable: true,
          default: null,
          isPrimaryKey: false,
          isUnique: false,
          isForeignKey: false,
        },
      ],
    },
  ],
};

// resolveSupabaseNode issues one sb()/fetch call (canvas lookup); a
// provisioned response resolves { ref: "abc-ref", provisioned: true }.
function mockProvisionedCanvas() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
    ok: true,
    json: async () => [
      {
        canvas: {
          nodes: [
            {
              id: NODE_ID,
              data: { provider: "supabase", supabaseProjectRef: "abc-ref" },
            },
          ],
          edges: [],
        },
      },
    ],
  } as unknown as Response);
}

function mockDraftCanvas() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
    ok: true,
    json: async () => [
      {
        canvas: {
          nodes: [{ id: NODE_ID, data: { provider: "supabase" } }],
          edges: [],
        },
      },
    ],
  } as unknown as Response);
}

describe("refreshNodeSnapshot", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("maps LiveSchema to TableDef[], excluding id/created_at and mapping types, then commits with clearAppliedColumns+setSnapshotAt", async () => {
    mockProvisionedCanvas();

    await refreshNodeSnapshot(ENV, USER_ID, PROJECT_ID, NODE_ID, SAMPLE_SCHEMA);

    expect(commitCanvasTables).toHaveBeenCalledTimes(1);
    const call = (commitCanvasTables as any).mock.calls[0];
    expect(call[0]).toBe(ENV);
    expect(call[1]).toBe(USER_ID);
    expect(call[2]).toBe(PROJECT_ID);
    expect(call[3]).toBe(NODE_ID);

    const tables = call[4];
    expect(tables).toHaveLength(1);
    const usersTable = tables[0];
    expect(usersTable.name).toBe("users");
    const colNames = usersTable.columns.map((c: any) => c.name);
    expect(colNames).not.toContain("id");
    expect(colNames).not.toContain("created_at");
    expect(colNames.sort()).toEqual(["age", "email", "ip", "meta"]);

    const email = usersTable.columns.find((c: any) => c.name === "email");
    expect(email.type).toBe("text");
    expect(email.unique).toBe(true);
    expect(email.nullable).toBeUndefined();

    const age = usersTable.columns.find((c: any) => c.name === "age");
    expect(age.type).toBe("int");
    expect(age.nullable).toBe(true);
    expect(age.unique).toBeUndefined();

    const meta = usersTable.columns.find((c: any) => c.name === "meta");
    expect(meta.type).toBe("jsonb");
    expect(meta.default).toBe("'{}'");

    const ip = usersTable.columns.find((c: any) => c.name === "ip");
    expect(ip.type).toBe("inet"); // unknown pg type preserved raw

    const opts = call[5];
    expect(opts.clearAppliedColumns).toBe(true);
    expect(typeof opts.setSnapshotAt).toBe("string");
  });

  it("no-ops (no introspect fetch beyond node resolution, no commit) when the node is not provisioned", async () => {
    mockDraftCanvas();

    await refreshNodeSnapshot(ENV, USER_ID, PROJECT_ID, NODE_ID);

    // Only the resolveSupabaseNode lookup fetch happened — no introspect
    // queries (which would issue 6 more fetches) and no commit.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(commitCanvasTables).not.toHaveBeenCalled();
  });

  it("uses prefetched schema and does NOT call introspectSchema when provided", async () => {
    mockProvisionedCanvas();

    await refreshNodeSnapshot(ENV, USER_ID, PROJECT_ID, NODE_ID, SAMPLE_SCHEMA);

    // Only the resolveSupabaseNode lookup fetch happened — prefetched schema
    // means introspectSchema's 6 catalog-query fetches never fire.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(commitCanvasTables).toHaveBeenCalledTimes(1);
  });

  it("obtains the token via getUserToken when no prefetched schema is given", async () => {
    mockProvisionedCanvas();
    // introspectSchema issues 6 catalog-query fetches; stub each to an empty
    // result set so the real introspectSchema resolves with no tables.
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    await refreshNodeSnapshot(ENV, USER_ID, PROJECT_ID, NODE_ID);

    expect(getUserToken).toHaveBeenCalledWith(ENV, USER_ID, "supabase");
    expect(commitCanvasTables).toHaveBeenCalledTimes(1);
    expect((commitCanvasTables as any).mock.calls[0][4]).toEqual([]);
  });
});
