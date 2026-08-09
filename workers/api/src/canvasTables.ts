/**
 * Canvas-persist helper for Supabase table schemas.
 *
 * Extracted from the inline fetch+patch block that used to live in
 * setSupabaseTables (routes/mcp.ts). This module ONLY persists `tables` onto
 * the target node's canvas data — it does not apply DDL to a live database
 * and does not write an audit log entry. Callers (the MCP tool, the
 * /mutate route) are responsible for those caller-specific steps.
 */
import type { Env } from "./types";
import { scopedQuery } from "./tenancy";
import { assertCanvasUnlocked, patchCanvasWithVersion } from "./canvasVersion";
import type { TableDef } from "./schema/supabaseSchema";
import type { CanvasNode, CanvasEdge } from "./routes/workflowProvision";

/**
 * Ownership-scoped, read-only lookup of a single canvas node's `data`.
 * Mirrors the same `id=eq.${projectId}&user_id=eq.${userId}` scoping
 * commitCanvasTables uses for its node-lookup fetch. Returns `null` (never
 * throws) when the project isn't found/owned or the node isn't present —
 * callers use this for best-effort/non-fatal reconcile checks, not for a
 * write path, so there's no canvas_version gate.
 */
export async function getNodeData(
  env: Env,
  userId: string,
  projectId: string,
  nodeId: string,
): Promise<Record<string, unknown> | null> {
  const wfRes = await scopedQuery(env, userId, "projects", {
    query: `id=eq.${projectId}&select=canvas&limit=1`,
  });
  if (!wfRes.ok) return null;
  const rows = (await wfRes.json()) as Array<{
    canvas: { nodes: CanvasNode[]; edges: CanvasEdge[] };
  }>;
  if (!rows.length) return null;

  const nodes: CanvasNode[] = rows[0].canvas?.nodes ?? [];
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  return node.data as Record<string, unknown>;
}

export async function commitCanvasTables(
  env: Env,
  userId: string,
  projectId: string,
  nodeId: string,
  tablesOrUpdater: TableDef[] | ((current: TableDef[]) => TableDef[]),
  opts?: { setSnapshotAt?: string; clearAppliedColumns?: boolean },
): Promise<{ projectRef: string | null }> {
  await assertCanvasUnlocked(env, projectId, userId);

  const wfRes = await scopedQuery(env, userId, "projects", {
    query: `id=eq.${projectId}&select=canvas,canvas_version&limit=1`,
  });
  if (!wfRes.ok) throw new Error("Failed to fetch workflow");
  const rows = (await wfRes.json()) as Array<{
    canvas: { nodes: CanvasNode[]; edges: CanvasEdge[] };
    canvas_version: number;
  }>;
  if (!rows.length) throw new Error("Workflow not found");

  const canvas = rows[0].canvas;
  const canvasVersion = rows[0].canvas_version;
  const nodes: CanvasNode[] = canvas.nodes ?? [];
  const nodeIndex = nodes.findIndex((n) => n.id === nodeId);
  if (nodeIndex === -1) throw new Error(`Node "${nodeId}" not found`);

  const node = nodes[nodeIndex];
  if ((node.data as any).provider !== "supabase")
    throw new Error(`Node "${nodeId}" is not a Supabase node`);

  // Read the live-project ref from the SAME snapshot we patch against, so the
  // caller's live-DDL decision stays coupled to this atomic read (no TOCTOU
  // between "should I apply DDL?" and "which version am I gating the write on?").
  const projectRef =
    ((node.data as any).supabaseProjectRef as string | undefined) ?? null;

  // When called with an updater, `current` is read from this SAME snapshot
  // whose canvas_version gates the PATCH below — read-reduce-write is atomic.
  // A concurrent write landing first is caught as a stale-version conflict by
  // patchCanvasWithVersion instead of being silently overwritten (I1). Let the
  // updater's throw (e.g. applyMutationToSeed validation errors) propagate
  // uncaught — callers map it to a status.
  const current = ((node.data as any).tables ?? []) as TableDef[];
  const tables =
    typeof tablesOrUpdater === "function"
      ? tablesOrUpdater(current)
      : tablesOrUpdater;

  const newData: Record<string, unknown> = { ...node.data, tables };
  if (opts?.setSnapshotAt) newData.schemaSnapshotAt = opts.setSnapshotAt;
  if (opts?.clearAppliedColumns) delete newData.appliedColumns;
  nodes[nodeIndex] = { ...node, data: newData };
  const updatedCanvas = { ...canvas, nodes };
  const updateResult = await patchCanvasWithVersion(
    env,
    projectId,
    canvasVersion,
    () => updatedCanvas as unknown as Record<string, unknown>,
    userId,
  );
  if (!updateResult.ok && updateResult.conflict)
    throw new Error(
      "canvas_conflict — canvas was modified concurrently. Re-fetch and retry.",
    );
  if (!updateResult.ok) throw new Error("Failed to update node");

  return { projectRef };
}
