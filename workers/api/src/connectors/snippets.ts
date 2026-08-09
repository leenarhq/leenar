import type { Env } from "../types";
import { scopedQuery } from "../tenancy";

export interface Snippet {
  id: string;
  name: string;
  sql: string;
  createdAt: string;
}

interface SnippetRow {
  id: string;
  name: string;
  sql: string;
  created_at: string;
}

function toSnippet(row: SnippetRow): Snippet {
  return { id: row.id, name: row.name, sql: row.sql, createdAt: row.created_at };
}

export async function listSnippets(
  env: Env,
  userId: string,
  projectId: string,
  nodeId: string,
): Promise<Snippet[]> {
  const res = await scopedQuery(env, userId, "db_query_snippets", {
    query: `project_id=eq.${encodeURIComponent(projectId)}&node_id=eq.${encodeURIComponent(nodeId)}&select=id,name,sql,created_at&order=created_at.desc`,
  });
  if (!res.ok) throw new Error("Failed to fetch snippets");
  const rows = await res.json<SnippetRow[]>();
  return rows.map(toSnippet);
}

export async function createSnippet(
  env: Env,
  userId: string,
  projectId: string,
  nodeId: string,
  name: string,
  sql: string,
): Promise<Snippet> {
  // scopedQuery injects user_id into the row for POST — no need to set it here.
  const res = await scopedQuery(env, userId, "db_query_snippets", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: { project_id: projectId, node_id: nodeId, name, sql },
  });
  if (!res.ok) throw new Error("Failed to save snippet");
  const rows = await res.json<SnippetRow[]>();
  return toSnippet(rows[0]);
}

export async function deleteSnippet(env: Env, userId: string, snippetId: string): Promise<void> {
  const res = await scopedQuery(env, userId, "db_query_snippets", {
    method: "DELETE",
    query: `id=eq.${encodeURIComponent(snippetId)}`,
  });
  if (!res.ok) throw new Error("Failed to delete snippet");
}
