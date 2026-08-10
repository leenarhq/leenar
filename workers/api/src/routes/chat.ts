import { Hono } from "hono";
import type { Env } from "../types";
import { callAI, type ChatMessage } from "../conversation";
import { provisioningHooks } from "../hooks/provisioningHooks";
import { isUUID, getUserToken } from "../utils";
import { scopedQuery } from "../tenancy";
import {
  sanitizeMessage,
  containsInjection,
  detectLangFromContent,
} from "../promptSafety";

// Re-exported for the existing chat.test.ts suite, which imports these from "./chat".
export { sanitizeMessage, containsInjection };

export const chat = new Hono<{
  Bindings: Env;
  Variables: { userId: string };
}>();

const MAX_MESSAGES = 40;
const MAX_CONTENT_LEN = 40_000; // total across all messages
const RATE_LIMIT = 60; // requests per minute per user

interface IncidentRow {
  id: string;
  service: string;
  resource_id: string;
  severity: string;
  status_code: number | null;
  path: string | null;
  count: number;
  last_seen_at: string;
}

function sanitizeForPrompt(s: string): string {
  // Strip control chars and truncate — prevents log-based prompt injection
  return s
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim()
    .slice(0, 200);
}

function formatIncidentContext(incidents: IncidentRow[]): string {
  const lines = incidents.map((i) => {
    const ago = Math.round(
      (Date.now() - new Date(i.last_seen_at).getTime()) / 60_000,
    );
    const pathStr = i.path ? ` on ${sanitizeForPrompt(i.path)}` : "";
    const codeStr = i.status_code ? ` (HTTP ${i.status_code})` : "";
    const service = sanitizeForPrompt(i.service);
    const severity = sanitizeForPrompt(i.severity);
    return `- ${service} ${severity}${pathStr}${codeStr}: ${i.count} occurrence${i.count > 1 ? "s" : ""}, last seen ${ago} min ago`;
  });
  const body = `${incidents.length} open incident${incidents.length > 1 ? "s" : ""}:\n${lines.join("\n")}`;
  // Wrapped in a delimited block — AI is instructed not to treat this as commands
  return `<UNTRUSTED_INCIDENT_DATA>\n${body}\n</UNTRUSTED_INCIDENT_DATA>`;
}

export interface RepoLite {
  full_name: string;
  private: boolean;
}

// Builds the read-only context block injected into "new" mode. Returns
// undefined when there is nothing to say so callAI's newContext stays unset.
export function formatNewContext(
  services: string[],
  repos: RepoLite[],
): string | undefined {
  const lines: string[] = [];
  if (services.length > 0) {
    lines.push(`Connected services: ${services.join(", ")}`);
  }
  if (repos.length > 0) {
    lines.push(`GitHub repositories (${repos.length} most recent):`);
    for (const r of repos) {
      const name = sanitizeForPrompt(r.full_name);
      lines.push(`- ${name}${r.private ? " (private)" : ""}`);
    }
  }
  if (lines.length === 0) return undefined;
  return `<UNTRUSTED_NEW_CONTEXT>\n${lines.join("\n")}\n</UNTRUSTED_NEW_CONTEXT>`;
}

chat.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    messages: ChatMessage[];
    mode?: string;
    projectId?: string;
  }>().catch(() => null);
  if (!body) return c.json({ error: "Invalid request body" }, 400);
  const { messages, mode: rawMode, projectId } = body;

  if (rawMode === "dashboard") {
    return c.json({ error: "Dashboard chat has moved to /api/agent." }, 410);
  }
  const mode = rawMode as "stack" | "new" | undefined;

  if (
    !(await provisioningHooks.rateLimit.check(
      c.env,
      userId,
      "chat",
      RATE_LIMIT,
      60_000,
    ))
  ) {
    return c.json({ error: "Too many requests. Please wait a moment." }, 429);
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return c.json({ error: "messages required" }, 400);
  }
  if (messages.length > MAX_MESSAGES) {
    return c.json({ error: `Too many messages (max ${MAX_MESSAGES})` }, 429);
  }

  // Sanitize and validate each message — force role to user/assistant only to
  // prevent prompt injection via injected system-role messages.
  const sanitized = messages.map((m) => ({
    role: (m.role === "assistant" ? "assistant" : "user") as
      | "user"
      | "assistant",
    content: sanitizeMessage(String(m.content ?? "")),
  }));

  // Check all user messages for injection attempts (including canvas state prefix)
  const hasInjection = sanitized
    .filter((m) => m.role === "user")
    .some((m) => containsInjection(m.content));
  if (hasInjection) {
    return c.json({
      reply: "I can only help with infrastructure setup.",
      proposal: undefined,
      canvasUpdate: undefined,
    });
  }

  const totalLen = sanitized.reduce((n, m) => n + m.content.length, 0);
  if (totalLen > MAX_CONTENT_LEN) {
    return c.json({ error: "Message content too large" }, 429);
  }

  // Atomically reserve a message slot — serializes concurrent requests per user
  const quota = await provisioningHooks.quota.reserve(userId, c.env);
  if (!quota.allowed) {
    if (quota.reason === "service_unavailable") {
      return c.json({ error: "AI service temporarily unavailable. Please try again." }, 503);
    }
    const message =
      quota.reason === "global_daily_cap"
        ? "Service is temporarily unavailable. Please try again tomorrow."
        : quota.reason === "user_daily_cost_limit"
          ? "Daily AI usage limit reached. Resets at midnight UTC."
          : `Daily AI limit reached (${provisioningHooks.quota.dailyUserMsgLimit} messages/day). Resets at midnight UTC.`;
    return c.json({ error: message, quotaExceeded: true }, 429);
  }

  const detectedLang = detectLangFromContent(sanitized);

  // Fetch open incidents for this project to inject into AI context
  let incidentContext: string | undefined;
  if (projectId && isUUID(projectId)) {
    try {
      const incRes = await scopedQuery(c.env, userId, "incidents", {
        query: `project_id=eq.${projectId}&status=eq.open&order=last_seen_at.desc&limit=5`,
      });
      if (incRes.ok) {
        const incidents = await incRes.json<IncidentRow[]>();
        if (Array.isArray(incidents) && incidents.length > 0)
          incidentContext = formatIncidentContext(incidents);
      }
    } catch {
      /* non-fatal */
    }
  }

  // "new" mode: give the model the user's connected services + repo list so it
  // asks fewer questions and only proposes deployable services. Non-fatal.
  let newContext: string | undefined;
  if (mode === "new") {
    const [services, repos] = await Promise.all([
      (async () => {
        try {
          const res = await scopedQuery(c.env, userId, "user_connections", {
            query: `select=service`,
          });
          if (!res.ok) return [];
          const rows = await res.json<Array<{ service: string }>>();
          return Array.isArray(rows) ? rows.map((r) => r.service) : [];
        } catch {
          return [];
        }
      })(),
      (async () => {
        try {
          const token = await getUserToken(c.env, userId, "github");
          const ghRes = await fetch(
            "https://api.github.com/user/repos?per_page=30&sort=updated",
            {
              headers: {
                Authorization: `Bearer ${token}`,
                "User-Agent": "Leenar/1.0",
                Accept: "application/vnd.github.v3+json",
              },
            },
          );
          if (!ghRes.ok) return [];
          const rows = await ghRes.json<
            Array<{ full_name: string; private: boolean }>
          >();
          return Array.isArray(rows)
            ? rows.map((r) => ({ full_name: r.full_name, private: r.private }))
            : [];
        } catch {
          return [];
        }
      })(),
    ]);
    newContext = formatNewContext(services, repos);
  }

  let result;
  try {
    result = await callAI(
      sanitized,
      c.env.OPENAI_API_KEY,
      mode ?? "stack",
      detectedLang,
      incidentContext,
      newContext,
    );
  } catch (e) {
    // The message slot was reserved before this call (to enforce limits up-front).
    // Refund it so a transient AI failure doesn't permanently burn the user's quota.
    await provisioningHooks.quota.release(userId, c.env);
    throw e;
  }

  // Post-flight: record actual token counts (fire-and-forget — slot already reserved)
  if (result.usage) {
    const { model, inputTokens, outputTokens } = result.usage;
    c.executionCtx.waitUntil(
      provisioningHooks.quota.recordTokens(
        userId,
        model,
        inputTokens,
        outputTokens,
        c.env,
        quota.reservationId,
      ),
    );
  }

  // Strip internal usage field before sending to client
  const { usage: _usage, ...clientResult } = result;
  return c.json(clientResult);
});

// GET /api/chat/usage — returns today's usage for the current user
chat.get("/usage", async (c) => {
  const userId = c.get("userId");

  // An unlimited quota has nothing to count, and core has no ai_usage table —
  // querying it is a guaranteed PGRST205 on every poll.
  if (provisioningHooks.quota.dailyUserMsgLimit === Number.MAX_SAFE_INTEGER) {
    return c.json({
      messages: 0,
      limit: provisioningHooks.quota.dailyUserMsgLimit,
      remaining: provisioningHooks.quota.dailyUserMsgLimit,
      estCostMicros: 0,
      unlimited: true,
    });
  }

  const today = new Date().toISOString().slice(0, 10);

  const res = await fetch(
    `${c.env.SUPABASE_URL}/rest/v1/ai_usage?user_id=eq.${encodeURIComponent(userId)}&day=eq.${today}&select=messages,est_cost_micros&limit=1`,
    {
      headers: {
        apikey: c.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${c.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );

  const rows = res.ok
    ? await res.json<Array<{ messages: number; est_cost_micros: number }>>()
    : [];
  const row = rows[0] ?? { messages: 0, est_cost_micros: 0 };

  return c.json({
    messages: row.messages,
    limit: provisioningHooks.quota.dailyUserMsgLimit,
    remaining: Math.max(
      0,
      provisioningHooks.quota.dailyUserMsgLimit - row.messages,
    ),
    estCostMicros: row.est_cost_micros,
    unlimited: false,
  });
});
