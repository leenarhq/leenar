/**
 * Unit tests for commitCanvasTables — the canvas-persist-only helper extracted
 * from setSupabaseTables (mcp.ts). Mirrors the sb()-mocking style used in
 * mcp.test.ts / routes/mcp.database.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./utils")>();
  return {
    ...actual,
    sb: vi.fn(),
  };
});

import { sb } from "./utils";
import { commitCanvasTables, getNodeData } from "./canvasTables";
import type { TableDef } from "./schema/supabaseSchema";

const PROJECT_ID = "12345678-1234-1234-1234-123456789012";
const USER_ID = "aabbccdd-0000-0000-0000-000000000001";
const NODE_ID = "aabbccdd-2222-2222-2222-000000000042";

function makeEnv() {
  return {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "svc-key",
  } as any;
}

const TABLES: TableDef[] = [
  { name: "posts", columns: [{ name: "title", type: "text" }] },
];

describe("commitCanvasTables", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists tables onto the node, commits via patchCanvasWithVersion, and returns the draft node's null ref", async () => {
    const env = makeEnv();
    const sbMock = sb as any;

    // 1. assertCanvasUnlocked lock check
    sbMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([{ canvas_locked_by: null, canvas_locked_at: null }]),
        { status: 200 },
      ),
    );
    // 2. fetch canvas+canvas_version for node lookup
    sbMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            canvas: {
              nodes: [
                { id: NODE_ID, data: { provider: "supabase", tables: [] } },
              ],
              edges: [],
            },
            canvas_version: 3,
          },
        ]),
        { status: 200 },
      ),
    );
    // 3. patchCanvasWithVersion internally calls loadCanvasWithVersion (sb GET)...
    sbMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            canvas: {
              nodes: [
                { id: NODE_ID, data: { provider: "supabase", tables: [] } },
              ],
              edges: [],
            },
            canvas_version: 3,
          },
        ]),
        { status: 200 },
      ),
    );
    // 4. ...then PATCH, returning representation rows (success)
    sbMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: PROJECT_ID }]), { status: 200 }),
    );

    // A node with no supabaseProjectRef is a draft node → returns null.
    await expect(
      commitCanvasTables(env, USER_ID, PROJECT_ID, NODE_ID, TABLES),
    ).resolves.toEqual({ projectRef: null });

    // The PATCH call body must carry the updated tables on the node.
    const patchCall = sbMock.mock.calls[3];
    const patchBody = JSON.parse((patchCall[2] as RequestInit).body as string);
    expect(patchBody.canvas.nodes[0].data.tables).toEqual(TABLES);
  });

  it("returns the provisioned node's supabaseProjectRef read from the same snapshot it patches", async () => {
    const env = makeEnv();
    const sbMock = sb as any;
    const provisionedNode = {
      id: NODE_ID,
      data: { provider: "supabase", supabaseProjectRef: "abc-ref", tables: [] },
    };

    // 1. assertCanvasUnlocked
    sbMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([{ canvas_locked_by: null, canvas_locked_at: null }]),
        { status: 200 },
      ),
    );
    // 2. node-lookup fetch (this is the snapshot projectRef is read from)
    sbMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { canvas: { nodes: [provisionedNode], edges: [] }, canvas_version: 7 },
        ]),
        { status: 200 },
      ),
    );
    // 3. loadCanvasWithVersion inside patchCanvasWithVersion
    sbMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { canvas: { nodes: [provisionedNode], edges: [] }, canvas_version: 7 },
        ]),
        { status: 200 },
      ),
    );
    // 4. PATCH success
    sbMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: PROJECT_ID }]), { status: 200 }),
    );

    await expect(
      commitCanvasTables(env, USER_ID, PROJECT_ID, NODE_ID, TABLES),
    ).resolves.toEqual({ projectRef: "abc-ref" });
  });

  it(`throws Node "<id>" not found when the node is absent`, async () => {
    const env = makeEnv();
    const sbMock = sb as any;

    sbMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([{ canvas_locked_by: null, canvas_locked_at: null }]),
        { status: 200 },
      ),
    );
    sbMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([{ canvas: { nodes: [], edges: [] }, canvas_version: 1 }]),
        { status: 200 },
      ),
    );

    await expect(
      commitCanvasTables(env, USER_ID, PROJECT_ID, NODE_ID, TABLES),
    ).rejects.toThrow(`Node "${NODE_ID}" not found`);
  });

  it(`throws Node "<id>" is not a Supabase node for a non-Supabase node`, async () => {
    const env = makeEnv();
    const sbMock = sb as any;

    sbMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([{ canvas_locked_by: null, canvas_locked_at: null }]),
        { status: 200 },
      ),
    );
    sbMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            canvas: {
              nodes: [{ id: NODE_ID, data: { provider: "vercel" } }],
              edges: [],
            },
            canvas_version: 1,
          },
        ]),
        { status: 200 },
      ),
    );

    await expect(
      commitCanvasTables(env, USER_ID, PROJECT_ID, NODE_ID, TABLES),
    ).rejects.toThrow(`Node "${NODE_ID}" is not a Supabase node`);
  });

  it("throws canvas_conflict verbatim when patchCanvasWithVersion reports a version conflict", async () => {
    const env = makeEnv();
    const sbMock = sb as any;

    sbMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([{ canvas_locked_by: null, canvas_locked_at: null }]),
        { status: 200 },
      ),
    );
    sbMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            canvas: {
              nodes: [{ id: NODE_ID, data: { provider: "supabase", tables: [] } }],
              edges: [],
            },
            canvas_version: 5,
          },
        ]),
        { status: 200 },
      ),
    );
    // loadCanvasWithVersion inside patchCanvasWithVersion
    sbMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            canvas: {
              nodes: [{ id: NODE_ID, data: { provider: "supabase", tables: [] } }],
              edges: [],
            },
            canvas_version: 5,
          },
        ]),
        { status: 200 },
      ),
    );
    // PATCH returns 0 rows → version mismatch → conflict
    sbMock.mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    await expect(
      commitCanvasTables(env, USER_ID, PROJECT_ID, NODE_ID, TABLES),
    ).rejects.toThrow(/canvas_conflict/);
  });

  it('throws "Failed to update node" when the PATCH request itself fails (non-conflict)', async () => {
    const env = makeEnv();
    const sbMock = sb as any;

    sbMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([{ canvas_locked_by: null, canvas_locked_at: null }]),
        { status: 200 },
      ),
    );
    sbMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            canvas: {
              nodes: [{ id: NODE_ID, data: { provider: "supabase", tables: [] } }],
              edges: [],
            },
            canvas_version: 5,
          },
        ]),
        { status: 200 },
      ),
    );
    sbMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            canvas: {
              nodes: [{ id: NODE_ID, data: { provider: "supabase", tables: [] } }],
              edges: [],
            },
            canvas_version: 5,
          },
        ]),
        { status: 200 },
      ),
    );
    // PATCH fails outright
    sbMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "boom" }), { status: 500 }));

    await expect(
      commitCanvasTables(env, USER_ID, PROJECT_ID, NODE_ID, TABLES),
    ).rejects.toThrow("Failed to update node");
  });

  // Updater form (I1 fix): the read-reduce-write must happen INSIDE the same
  // version-gated snapshot commitCanvasTables reads for the PATCH, so a
  // concurrent write landing between "read current" and "patch" is caught as
  // a stale-version conflict instead of silently overwritten.
  it("updater form: computes next from the node's current tables read in THIS snapshot, commits it, and returns {projectRef}", async () => {
    const env = makeEnv();
    const sbMock = sb as any;
    const existingTables: TableDef[] = [
      { name: "author", columns: [{ name: "name", type: "text" }] },
    ];
    const nodeWithTables = {
      id: NODE_ID,
      data: { provider: "supabase", tables: existingTables },
    };

    // 1. assertCanvasUnlocked
    sbMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([{ canvas_locked_by: null, canvas_locked_at: null }]),
        { status: 200 },
      ),
    );
    // 2. node-lookup fetch — this is the snapshot the updater's `current` is read from
    sbMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { canvas: { nodes: [nodeWithTables], edges: [] }, canvas_version: 9 },
        ]),
        { status: 200 },
      ),
    );
    // 3. loadCanvasWithVersion inside patchCanvasWithVersion
    sbMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { canvas: { nodes: [nodeWithTables], edges: [] }, canvas_version: 9 },
        ]),
        { status: 200 },
      ),
    );
    // 4. PATCH success
    sbMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: PROJECT_ID }]), { status: 200 }),
    );

    const updater = vi.fn((current: TableDef[]) => [...current, TABLES[0]]);

    await expect(
      commitCanvasTables(env, USER_ID, PROJECT_ID, NODE_ID, updater),
    ).resolves.toEqual({ projectRef: null });

    // The updater received the tables read from THIS snapshot (not some
    // separately-fetched "before" state).
    expect(updater).toHaveBeenCalledWith(existingTables);

    const patchCall = sbMock.mock.calls[3];
    const patchBody = JSON.parse((patchCall[2] as RequestInit).body as string);
    expect(patchBody.canvas.nodes[0].data.tables).toEqual([
      ...existingTables,
      TABLES[0],
    ]);
  });

  it("updater form: an updater that throws propagates, and no PATCH is issued", async () => {
    const env = makeEnv();
    const sbMock = sb as any;

    // 1. assertCanvasUnlocked
    sbMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([{ canvas_locked_by: null, canvas_locked_at: null }]),
        { status: 200 },
      ),
    );
    // 2. node-lookup fetch
    sbMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            canvas: {
              nodes: [{ id: NODE_ID, data: { provider: "supabase", tables: [] } }],
              edges: [],
            },
            canvas_version: 2,
          },
        ]),
        { status: 200 },
      ),
    );

    const throwingUpdater = () => {
      throw new Error('Column "id" is reserved and cannot be dropped');
    };

    await expect(
      commitCanvasTables(env, USER_ID, PROJECT_ID, NODE_ID, throwingUpdater),
    ).rejects.toThrow('Column "id" is reserved and cannot be dropped');

    // Only the lock check + node-lookup fetch happened — no PATCH attempt.
    expect(sbMock).toHaveBeenCalledTimes(2);
  });

  // Piece 2 (Phase 3, decision D1): optional 6th `opts` param stamps
  // schemaSnapshotAt / clears appliedColumns inside the SAME version-gated
  // snapshot write. Purely additive — see the "without opts" regression
  // guard test below for byte-identical behavior when opts is omitted.
  describe("opts (Phase 3 snapshot stamping)", () => {
    it("opts.setSnapshotAt stamps node.data.schemaSnapshotAt in the committed patch", async () => {
      const env = makeEnv();
      const sbMock = sb as any;

      sbMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ canvas_locked_by: null, canvas_locked_at: null }]),
          { status: 200 },
        ),
      );
      sbMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              canvas: {
                nodes: [{ id: NODE_ID, data: { provider: "supabase", tables: [] } }],
                edges: [],
              },
              canvas_version: 3,
            },
          ]),
          { status: 200 },
        ),
      );
      sbMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              canvas: {
                nodes: [{ id: NODE_ID, data: { provider: "supabase", tables: [] } }],
                edges: [],
              },
              canvas_version: 3,
            },
          ]),
          { status: 200 },
        ),
      );
      sbMock.mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: PROJECT_ID }]), { status: 200 }),
      );

      await expect(
        commitCanvasTables(env, USER_ID, PROJECT_ID, NODE_ID, TABLES, {
          setSnapshotAt: "2026-08-01T00:00:00.000Z",
        }),
      ).resolves.toEqual({ projectRef: null });

      const patchCall = sbMock.mock.calls[3];
      const patchBody = JSON.parse((patchCall[2] as RequestInit).body as string);
      expect(patchBody.canvas.nodes[0].data.schemaSnapshotAt).toBe(
        "2026-08-01T00:00:00.000Z",
      );
      expect(patchBody.canvas.nodes[0].data.tables).toEqual(TABLES);
    });

    it("opts.clearAppliedColumns removes the appliedColumns key from the committed patch", async () => {
      const env = makeEnv();
      const sbMock = sb as any;
      const nodeWithApplied = {
        id: NODE_ID,
        data: {
          provider: "supabase",
          tables: [],
          appliedColumns: { posts: ["title"] },
        },
      };

      sbMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ canvas_locked_by: null, canvas_locked_at: null }]),
          { status: 200 },
        ),
      );
      sbMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { canvas: { nodes: [nodeWithApplied], edges: [] }, canvas_version: 3 },
          ]),
          { status: 200 },
        ),
      );
      sbMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { canvas: { nodes: [nodeWithApplied], edges: [] }, canvas_version: 3 },
          ]),
          { status: 200 },
        ),
      );
      sbMock.mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: PROJECT_ID }]), { status: 200 }),
      );

      await expect(
        commitCanvasTables(env, USER_ID, PROJECT_ID, NODE_ID, TABLES, {
          clearAppliedColumns: true,
        }),
      ).resolves.toEqual({ projectRef: null });

      const patchCall = sbMock.mock.calls[3];
      const patchBody = JSON.parse((patchCall[2] as RequestInit).body as string);
      expect(patchBody.canvas.nodes[0].data).not.toHaveProperty("appliedColumns");
      expect(patchBody.canvas.nodes[0].data.tables).toEqual(TABLES);
    });

    it("without opts, node data is unchanged except tables (regression guard)", async () => {
      const env = makeEnv();
      const sbMock = sb as any;
      const nodeWithExtras = {
        id: NODE_ID,
        data: {
          provider: "supabase",
          tables: [],
          appliedColumns: { posts: ["title"] },
          label: "My DB",
        },
      };

      sbMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ canvas_locked_by: null, canvas_locked_at: null }]),
          { status: 200 },
        ),
      );
      sbMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { canvas: { nodes: [nodeWithExtras], edges: [] }, canvas_version: 3 },
          ]),
          { status: 200 },
        ),
      );
      sbMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { canvas: { nodes: [nodeWithExtras], edges: [] }, canvas_version: 3 },
          ]),
          { status: 200 },
        ),
      );
      sbMock.mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: PROJECT_ID }]), { status: 200 }),
      );

      await expect(
        commitCanvasTables(env, USER_ID, PROJECT_ID, NODE_ID, TABLES),
      ).resolves.toEqual({ projectRef: null });

      const patchCall = sbMock.mock.calls[3];
      const patchBody = JSON.parse((patchCall[2] as RequestInit).body as string);
      expect(patchBody.canvas.nodes[0].data).toEqual({
        provider: "supabase",
        tables: TABLES,
        appliedColumns: { posts: ["title"] },
        label: "My DB",
      });
    });
  });

  describe("getNodeData", () => {
    it("returns the node's data for an owned project/node", async () => {
      const env = makeEnv();
      const sbMock = sb as any;
      const nodeData = {
        provider: "supabase",
        tables: [],
        appliedColumns: { posts: ["title"] },
      };

      sbMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              canvas: {
                nodes: [{ id: NODE_ID, data: nodeData }],
                edges: [],
              },
            },
          ]),
          { status: 200 },
        ),
      );

      await expect(
        getNodeData(env, USER_ID, PROJECT_ID, NODE_ID),
      ).resolves.toEqual(nodeData);

      // Scoped by both project id AND user_id — same ownership scoping
      // commitCanvasTables uses for its node-lookup fetch.
      const call = sbMock.mock.calls[0];
      expect(call[1]).toContain(`id=eq.${PROJECT_ID}`);
      expect(call[1]).toContain(`user_id=eq.${USER_ID}`);
    });

    it("returns null when the node is missing (does not throw)", async () => {
      const env = makeEnv();
      const sbMock = sb as any;

      sbMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ canvas: { nodes: [], edges: [] } }]),
          { status: 200 },
        ),
      );

      await expect(
        getNodeData(env, USER_ID, PROJECT_ID, NODE_ID),
      ).resolves.toBeNull();
    });

    it("returns null when the project isn't found/owned (does not throw)", async () => {
      const env = makeEnv();
      const sbMock = sb as any;

      sbMock.mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 }),
      );

      await expect(
        getNodeData(env, USER_ID, PROJECT_ID, NODE_ID),
      ).resolves.toBeNull();
    });

    it("is scoped by user_id — a different user's request finds nothing", async () => {
      const env = makeEnv();
      const sbMock = sb as any;

      // The mocked sb() doesn't itself enforce scoping (that's Supabase's
      // job via the querystring filter) — but a wrong-owner request that
      // hits an empty result set (as the real ?user_id=eq. filter would
      // produce) must resolve to null, not throw or leak data.
      sbMock.mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 }),
      );

      await expect(
        getNodeData(env, "someone-else", PROJECT_ID, NODE_ID),
      ).resolves.toBeNull();

      const call = sbMock.mock.calls[0];
      expect(call[1]).toContain(`user_id=eq.someone-else`);
    });
  });
});
