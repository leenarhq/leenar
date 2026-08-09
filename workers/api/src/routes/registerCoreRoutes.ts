import type { Hono } from "hono";
import type { AppEnv } from "../appSetup";
import { isUUID, auditLog } from "../utils";
import { signDoToken } from "../doAuth";
import { createLogger } from "../logger";
import { hooks } from "./hooks";
import { oauth } from "./oauth";
import { stacks } from "./stacks";
import { chat } from "./chat";
import { connections } from "./connections";
import { workflowProvision } from "./workflowProvision";
import { resend } from "./resend";
import { github } from "./github";
import { vercel } from "./vercel";
import { supabaseRouter } from "./supabase";
import { databaseRouter } from "./database";
import { webhooksRouter } from "./webhooks";
import { driftsRouter } from "./drifts";
import { logsRouter } from "./logs";
import { apiKeysRouter } from "./apiKeys";
import { environmentsRouter } from "./environments";

const log = createLogger({ module: "registerCoreRoutes" });

export function registerCoreRoutes(app: Hono<AppEnv>): void {
  app.route("/api/hooks", hooks); // JWT required — called from frontend after signup
  app.route("/api/oauth", oauth);
  app.route("/api/stacks", stacks);
  app.route("/api/chat", chat);
  app.route("/api/connections", connections);
  app.route("/api/projects", workflowProvision);
  app.route("/api/resend", resend);
  app.route("/api/github", github);
  app.route("/api/vercel", vercel);
  app.route("/api/supabase", supabaseRouter);
  app.route("/api/database", databaseRouter);
  app.route("/api/webhooks", webhooksRouter);
  app.route("/api/drifts", driftsRouter);
  app.route("/api/logs", logsRouter);
  app.route("/api/keys", apiKeysRouter);
  app.route("/api/environments", environmentsRouter);

  // POST /api/provision/:stackId  →  start provisioner DO
  app.post("/api/provision/:stackId", async (c) => {
    const userId = c.get("userId");
    const stackId = c.req.param("stackId");
    if (!isUUID(stackId)) return c.json({ error: "Invalid id" }, 400);

    // Verify ownership and load stack data from DB — never trust approvedStack from body
    const chk = await fetch(
      `${c.env.SUPABASE_URL}/rest/v1/stacks?id=eq.${stackId}&user_id=eq.${userId}&select=id,name,requirements&limit=1`,
      {
        headers: {
          apikey: c.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${c.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );
    const rows = (await chk.json()) as Array<{
      id: string;
      name: string;
      requirements: {
        services?: Array<{ service_type: string; existing_repo?: string | null }>;
      } | null;
    }>;
    if (!rows[0]) return c.json({ error: "Not found" }, 404);

    // Rebuild approvedStack server-side from DB — user body is intentionally ignored
    const stack = rows[0];
    const approvedStack = {
      projectName: stack.name,
      steps: (stack.requirements?.services ?? []).map((svc) => ({
        service: svc.service_type,
        action: "provision",
        params: svc.existing_repo ? { existing_repo: svc.existing_repo } : {},
      })),
    };

    const id = c.env.PROVISIONER.idFromName(stackId);
    const stub = c.env.PROVISIONER.get(id);

    const doToken = await signDoToken(c.env.INTERNAL_SECRET, "start");
    const doRes = await stub.fetch(
      new Request("https://do/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Token": doToken,
        },
        body: JSON.stringify({ stackId, userId, approvedStack }),
      }),
    );
    if (!doRes.ok) {
      log.error("provision.do_start_failed", { stackId, status: doRes.status });
      return c.json({ error: "Failed to start provisioning" }, 500);
    }

    auditLog(
      c.env,
      userId,
      "deploy_started",
      { stackId, stackName: stack.name },
      c.req.header("CF-Connecting-IP") ?? undefined,
    );
    return c.json({ ok: true, stackId });
  });

  // DELETE /api/provision/:stackId  →  cancel
  app.delete("/api/provision/:stackId", async (c) => {
    const userId = c.get("userId");
    const stackId = c.req.param("stackId");
    if (!isUUID(stackId)) return c.json({ error: "Invalid id" }, 400);

    // Verify caller owns the stack before cancelling
    const chk = await fetch(
      `${c.env.SUPABASE_URL}/rest/v1/stacks?id=eq.${stackId}&user_id=eq.${userId}&select=id&limit=1`,
      {
        headers: {
          apikey: c.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${c.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );
    const rows = (await chk.json()) as unknown[];
    if (!rows[0]) return c.json({ error: "Not found" }, 404);

    const id = c.env.PROVISIONER.idFromName(stackId);
    const stub = c.env.PROVISIONER.get(id);

    const cancelToken = await signDoToken(c.env.INTERNAL_SECRET, "cancel");
    const cancelRes = await stub.fetch(
      new Request("https://do/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Token": cancelToken,
        },
        body: JSON.stringify({ stackId }),
      }),
    );
    if (!cancelRes.ok) {
      log.error("provision.do_cancel_failed", {
        stackId,
        status: cancelRes.status,
      });
      return c.json({ error: "Failed to cancel provisioning" }, 500);
    }
    auditLog(
      c.env,
      userId,
      "deploy_cancelled",
      { stackId },
      c.req.header("CF-Connecting-IP") ?? undefined,
    );
    return c.json({ ok: true });
  });
}
