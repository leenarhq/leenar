import { Hono } from "hono";
import type { Env } from "../types";
import { sb, isUUID, getUserToken } from "../utils";
import { scopedQuery } from "../tenancy";
import { createLogger } from "../logger";

const log = createLogger({ module: "logs" });

export const logsRouter = new Hono<{
  Bindings: Env;
  Variables: { userId: string };
}>();

const VERCEL_API = "https://api.vercel.com";

interface CanvasNode {
  id: string;
  data: Record<string, unknown>;
}

// GET /api/logs/:projectId
export async function getLogsData(projectId: string, userId: string, env: Env) {
  if (!isUUID(projectId)) throw new Error("Invalid projectId");

  // Verify ownership
  const wfRes = await scopedQuery(env, userId, "projects", {
    query: `id=eq.${projectId}&select=id,canvas&limit=1`,
  });
  if (!wfRes.ok) throw new Error("Failed to read project");
  const [wf] =
    await wfRes.json<
      Array<{ id: string; canvas: { nodes?: CanvasNode[] } | null }>
    >();
  if (!wf) throw new Error("Project not found");

  // Primary source: stack_services (written by the DO on every provision, always authoritative)
  // Two separate queries — nested select requires FK relationship which may not be configured.
  const stacksRes = await scopedQuery(env, userId, "stacks", {
    query: `project_id=eq.${projectId}&select=id&order=created_at.desc&limit=10`,
  });
  let stackRows: Array<{ id: string }> = [];
  if (stacksRes.ok) {
    stackRows = await stacksRes.json<Array<{ id: string }>>();
  } else {
    const errText = await stacksRes.text().catch(() => "");
    log.error("logs.stacks_query_failed", {
      status: stacksRes.status,
      body: errText,
    });
  }
  log.info("logs.stacks_found", { count: stackRows.length, projectId });

  const serviceIds: Record<string, string> = {};
  if (stackRows.length > 0) {
    const stackIds = stackRows.map((r) => r.id).join(",");
    // NOT migrated to a tenancy helper: stack_services has no user_id column, and
    // scopedByStack only supports a single stack_id=eq.<id> filter — it can't express
    // this multi-id `stack_id=in.(...)`. Safe by construction: stackIds is derived
    // exclusively from `stacksRes` above, which is already scoped to this userId via
    // scopedQuery, so every id here is already proven to belong to the caller.
    const ssRes = await sb(
      env,
      `stack_services?stack_id=in.(${stackIds})&select=service_type,external_id,stack_id`,
    );
    if (ssRes.ok) {
      const ssRows =
        await ssRes.json<
          Array<{
            service_type: string;
            external_id: string | null;
            stack_id: string;
          }>
        >();
      log.info("logs.stack_services_found", {
        count: ssRows.length,
        rows: ssRows,
      });
      const stackOrder = new Map(stackRows.map((r, i) => [r.id, i]));
      const sorted = ssRows.sort(
        (a, b) =>
          (stackOrder.get(b.stack_id) ?? 0) - (stackOrder.get(a.stack_id) ?? 0),
      );
      for (const svc of sorted) {
        if (svc.external_id) serviceIds[svc.service_type] = svc.external_id;
      }
    } else {
      const errText = await ssRes.text().catch(() => "");
      log.error("logs.stack_services_query_failed", {
        status: ssRes.status,
        body: errText,
      });
    }
  }

  // Fallback: canvas nodes for any IDs not found in stack_services
  const canvasNodes = wf.canvas?.nodes ?? [];
  log.info("logs.canvas_nodes", {
    count: canvasNodes.length,
    providers: canvasNodes.map((n) => n.data?.provider),
  });
  for (const node of canvasNodes) {
    const p = (node.data?.provider as string | undefined)?.toLowerCase();
    if (p === "vercel" && !serviceIds.vercel && node.data?.vercelProjectId)
      serviceIds.vercel = node.data.vercelProjectId as string;
    if (
      p === "supabase" &&
      !serviceIds.supabase &&
      node.data?.supabaseProjectRef
    )
      serviceIds.supabase = node.data.supabaseProjectRef as string;
    if (p === "github" && !serviceIds.github && node.data?.githubRepoName)
      serviceIds.github = node.data.githubRepoName as string;
    if (p === "resend" && !serviceIds.resend) serviceIds.resend = "connected";
  }

  // Also check canvas for Resend node (it has no external_id in stack_services)
  const hasResend = canvasNodes.some(
    (n) => (n.data?.provider as string | undefined)?.toLowerCase() === "resend",
  );

  log.info("logs.service_ids", { serviceIds, hasResend });

  const result: Record<string, unknown> = {};

  await Promise.all([
    // Vercel
    (async () => {
      const projectId = serviceIds.vercel;
      if (!projectId) return;
      const token = await getUserToken(env, userId, "vercel").catch(
        () => null,
      );
      if (!token) return;
      try {
        const res = await fetch(
          `${VERCEL_API}/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=15`,
          { headers: { Authorization: `Bearer ${token}` }, redirect: "manual" },
        );
        if (res.status === 0 || !res.ok) return;
        const data = await res.json<{ deployments?: unknown[] }>();
        result.vercel = {
          projectId,
          deployments: (data.deployments ?? []).map((d: any) => ({
            id: d.uid,
            url: d.url ? `https://${d.url}` : null,
            state: d.state,
            createdAt: d.createdAt,
            commitMessage:
              d.meta?.githubCommitMessage ??
              d.meta?.gitlabCommitMessage ??
              null,
            commitRef: d.meta?.githubCommitRef ?? null,
            branch: d.meta?.githubCommitRef ?? null,
          })),
        };
      } catch (err) {
        log.warn("service_log_fetch_failed", {
          provider: "vercel",
          err: err instanceof Error ? err.message : String(err),
        });
      }
    })(),

    // GitHub
    (async () => {
      const repoName = serviceIds.github;
      if (
        !repoName ||
        !/^[a-zA-Z0-9_.-]{1,100}\/[a-zA-Z0-9_.-]{1,100}$/.test(repoName)
      )
        return;
      const token = await getUserToken(env, userId, "github").catch(
        () => null,
      );
      if (!token) return;
      try {
        const [owner, repo] = repoName.split("/");
        const res = await fetch(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=20`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "User-Agent": "Leenar/1.0",
            },
            redirect: "manual",
          },
        );
        if (res.status === 0 || !res.ok) return;
        const commits = await res.json<unknown[]>();
        result.github = {
          repoName,
          commits: commits.map((c: any) => ({
            sha: c.sha?.slice(0, 7),
            message: c.commit?.message?.split("\n")[0] ?? "",
            author: c.commit?.author?.name ?? "",
            date: c.commit?.author?.date ?? "",
            url: c.html_url ?? "",
          })),
        };
      } catch (err) {
        log.warn("service_log_fetch_failed", {
          provider: "github",
          err: err instanceof Error ? err.message : String(err),
        });
      }
    })(),

    // Supabase
    (async () => {
      const ref = serviceIds.supabase;
      if (!ref) return;
      const token = await getUserToken(env, userId, "supabase").catch(
        () => null,
      );
      if (!token) return;
      try {
        const res = await fetch(`https://api.supabase.com/v1/projects/${ref}`, {
          headers: { Authorization: `Bearer ${token}` },
          redirect: "manual",
        });
        if (res.status === 0 || !res.ok) return;
        const proj = await res.json<any>();
        result.supabase = {
          ref,
          name: proj.name,
          status: proj.status,
          region: proj.region,
          createdAt: proj.created_at,
        };
      } catch (err) {
        log.warn("service_log_fetch_failed", {
          provider: "supabase",
          err: err instanceof Error ? err.message : String(err),
        });
      }
    })(),

    // Resend
    (async () => {
      if (!hasResend) return;
      const token = await getUserToken(env, userId, "resend").catch(
        () => null,
      );
      if (!token) return;
      try {
        const res = await fetch("https://api.resend.com/emails?limit=20", {
          headers: { Authorization: `Bearer ${token}` },
          redirect: "manual",
        });
        if (res.status === 0 || !res.ok) return;
        const data = await res.json<{ data?: unknown[] }>();
        result.resend = {
          emails: (data.data ?? []).map((e: any) => ({
            id: e.id,
            from: e.from,
            to: e.to,
            subject: e.subject,
            createdAt: e.created_at,
            lastEvent: e.last_event,
          })),
        };
      } catch (err) {
        log.warn("service_log_fetch_failed", {
          provider: "resend",
          err: err instanceof Error ? err.message : String(err),
        });
      }
    })(),
  ]);

  return result;
}

logsRouter.get("/:projectId", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  try {
    const data = await getLogsData(projectId, userId, c.env);
    return c.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "Invalid projectId") return c.json({ error: msg }, 400);
    if (msg === "Project not found") return c.json({ error: msg }, 404);
    return c.json({ error: msg }, 500);
  }
});
