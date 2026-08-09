import { describe, it, expect } from "vitest";
import { backupMatchesServer, backupKeyFor } from "./useWorkflowPersistence";

describe("backupKeyFor", () => {
  it("scopes the key by environment when an envId is present", () => {
    expect(backupKeyFor("wf1", "envA")).toBe("leenar_canvas_backup_wf1_envA");
  });

  it("produces distinct keys for different environments of the same workflow", () => {
    expect(backupKeyFor("wf1", "envA")).not.toBe(backupKeyFor("wf1", "envB"));
  });

  it("falls back to the unscoped key when envId is null", () => {
    expect(backupKeyFor("wf1", null)).toBe("leenar_canvas_backup_wf1");
  });

  it("falls back to the unscoped key when envId is undefined", () => {
    expect(backupKeyFor("wf1", undefined)).toBe("leenar_canvas_backup_wf1");
  });
});

describe("backupMatchesServer", () => {
  const serverCanvas = {
    nodes: [{ id: "n1", position: { x: 0, y: 0 }, data: {} }],
    edges: [{ id: "e1", source: "n1", target: "n2" }],
  };

  it("returns true when backup nodes and edges match server", () => {
    const backup = {
      nodes: [{ id: "n1", position: { x: 0, y: 0 }, data: {} }],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
    };
    expect(backupMatchesServer(backup, serverCanvas)).toBe(true);
  });

  it("returns false when backup nodes differ", () => {
    const backup = {
      nodes: [{ id: "n1", position: { x: 999, y: 0 }, data: {} }],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
    };
    expect(backupMatchesServer(backup, serverCanvas)).toBe(false);
  });

  it("returns false when backup edges differ", () => {
    const backup = {
      nodes: [{ id: "n1", position: { x: 0, y: 0 }, data: {} }],
      edges: [{ id: "e1", source: "n1", target: "n99" }],
    };
    expect(backupMatchesServer(backup, serverCanvas)).toBe(false);
  });

  it("returns true when both nodes and edges are empty arrays", () => {
    expect(
      backupMatchesServer({ nodes: [], edges: [] }, { nodes: [], edges: [] }),
    ).toBe(true);
  });

  it("returns false when backup has extra node not on server", () => {
    const backup = {
      nodes: [
        { id: "n1", position: { x: 0, y: 0 }, data: {} },
        { id: "n2", position: { x: 100, y: 0 }, data: {} },
      ],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
    };
    expect(backupMatchesServer(backup, serverCanvas)).toBe(false);
  });

  // Postgres JSONB does not preserve object key order, so the canvas comes back
  // from the server with keys in a different order than the local backup wrote.
  // Content-identical canvases must still compare equal regardless of key order.
  it("returns true when keys are reordered (JSONB round-trip)", () => {
    const backup = {
      nodes: [{ id: "n1", position: { x: 0, y: 0 }, data: {} }],
      edges: [{ id: "e1", source: "n1", target: "n2" }],
    };
    // Same content as serverCanvas, but object keys in a different order.
    const reorderedServer = {
      nodes: [{ data: {}, position: { y: 0, x: 0 }, id: "n1" }],
      edges: [{ target: "n2", source: "n1", id: "e1" }],
    };
    expect(backupMatchesServer(backup, reorderedServer)).toBe(true);
  });

  it("returns true when nested data keys are reordered", () => {
    const backup = {
      nodes: [
        {
          id: "n1",
          position: { x: 0, y: 0 },
          data: { provider: "vercel", label: "web" },
        },
      ],
      edges: [],
    };
    const reorderedServer = {
      nodes: [
        {
          id: "n1",
          position: { x: 0, y: 0 },
          data: { label: "web", provider: "vercel" },
        },
      ],
      edges: [],
    };
    expect(backupMatchesServer(backup, reorderedServer)).toBe(true);
  });

  // The server (CanvasNodeSchema) strips every field ReactFlow adds to a node
  // — measured, selected, dragging, width, height, positionAbsolute, etc. — so
  // the persisted node only keeps {id, type, position, data}. The local backup
  // holds the full toObject() node WITH those ephemeral fields. Content-identical
  // canvases must still compare equal despite the backup's extra node-level keys.
  // Runtime/derived node-data (provision status, resource IDs, drift/incident
  // counts, usage) is owned by the backend and monitoring hooks — never authoring
  // intent. It must be ignored when deciding whether the canvas changed, otherwise
  // a drift-count update or a deploy status mirror would trigger a spurious save.
  it("ignores runtime node-data fields (status, resource IDs, drift/usage)", () => {
    const authoring = {
      nodes: [
        { id: "n1", position: { x: 0, y: 0 }, data: { provider: "vercel" } },
      ],
      edges: [],
    };
    const withRuntime = {
      nodes: [
        {
          id: "n1",
          position: { x: 0, y: 0 },
          data: {
            provider: "vercel",
            status: "provisioned",
            provisionedAt: "2026-01-01T00:00:00Z",
            vercelProjectId: "prj_123",
            driftCount: 3,
            incidentCount: 1,
            usage: { db_size: 42 },
          },
        },
      ],
      edges: [],
    };
    expect(backupMatchesServer(withRuntime, authoring)).toBe(true);
  });

  it("still detects a real authoring change alongside runtime fields", () => {
    const a = {
      nodes: [
        {
          id: "n1",
          position: { x: 0, y: 0 },
          data: { provider: "vercel", label: "web", driftCount: 2 },
        },
      ],
      edges: [],
    };
    const b = {
      nodes: [
        {
          id: "n1",
          position: { x: 0, y: 0 },
          data: { provider: "vercel", label: "api", driftCount: 9 },
        },
      ],
      edges: [],
    };
    // label differs (authoring) → not equal, even though driftCount also differs
    expect(backupMatchesServer(a, b)).toBe(false);
  });

  it("ignores ReactFlow ephemeral node fields stripped by the server", () => {
    const backup = {
      nodes: [
        {
          id: "n1",
          type: "service",
          position: { x: 0, y: 0 },
          data: { provider: "vercel" },
          // fields ReactFlow adds that the server strips:
          measured: { width: 240, height: 80 },
          selected: true,
          dragging: false,
          width: 240,
          height: 80,
          positionAbsolute: { x: 0, y: 0 },
        },
      ],
      edges: [],
    };
    const server = {
      nodes: [
        {
          id: "n1",
          type: "service",
          position: { x: 0, y: 0 },
          data: { provider: "vercel" },
        },
      ],
      edges: [],
    };
    expect(backupMatchesServer(backup, server)).toBe(true);
  });
});
