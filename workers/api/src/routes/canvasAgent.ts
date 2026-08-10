// POST /api/canvas-agent — the workspace canvas chat.
//
// Mounted by registerCoreRoutes, so BOTH editions serve it and the browser
// takes one code path everywhere. It is deliberately not a second mount on
// /api/agent: registerCoreRoutes also runs in the cloud build, and a second
// router on that prefix would shadow the cloud agent by registration order
// and break mode:"dashboard".
//
// Scope is hardcoded to "canvas" — read tools plus canvas authoring, no
// destructive action, so there is no pending/confirm handshake here and no
// dependency on channels/channelAgent (both cloud-only).
import { Hono } from "hono";
import type { Env } from "../types";
import type { ChatMessage } from "../conversation";
import { runAgent } from "../agentRuntime";
import { provisioningHooks } from "../hooks/provisioningHooks";
import { isUUID } from "../utils";
import {
  sanitizeMessage,
  containsInjection,
  detectLangFromContent,
} from "../promptSafety";

export const canvasAgentRouter = new Hono<{
  Bindings: Env;
  Variables: {
    userId: string;
    authMethod: "jwt" | "api_key";
    apiKeyScope: "read" | "write";
  };
}>();

const MAX_MESSAGES = 40;
const MAX_CONTENT_LEN = 40_000;
const RATE_LIMIT = 30; // requests/minute/user — matches /api/agent

canvasAgentRouter.post("/", async (c) => {
  const userId = c.get("userId");

  if (
    !(await provisioningHooks.rateLimit.check(
      c.env,
      userId,
      "canvas-agent",
      RATE_LIMIT,
      60_000,
    ))
  ) {
    return c.json({ error: "Too many requests. Please wait a moment." }, 429);
  }

  const body = await c.req
    .json<{
      messages: ChatMessage[];
      projectId?: string;
      canvas?: { nodes: unknown[]; edges: unknown[] };
    }>()
    .catch(() => null);
  if (!body) return c.json({ error: "Invalid request body" }, 400);

  const { messages, projectId, canvas } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return c.json({ error: "messages required" }, 400);
  }
  if (messages.length > MAX_MESSAGES) {
    return c.json({ error: `Too many messages (max ${MAX_MESSAGES})` }, 429);
  }
  if (projectId !== undefined && !isUUID(projectId)) {
    return c.json({ error: "Invalid projectId" }, 400);
  }
  if (!canvas || !Array.isArray(canvas.nodes) || !Array.isArray(canvas.edges)) {
    return c.json({ error: "canvas snapshot required" }, 400);
  }
  if (canvas.nodes.length > 100 || canvas.edges.length > 200) {
    return c.json({ error: "Canvas too large" }, 413);
  }

  // SECURITY: canvas authoring is a write-level surface, so a read-scoped API
  // key is refused regardless of what it asks for. Checked before the quota
  // reservation so a rejected request never burns a slot.
  if (c.get("authMethod") === "api_key" && c.get("apiKeyScope") !== "write") {
    return c.json(
      { error: "This API key is read-only and cannot edit a canvas." },
      403,
    );
  }

  // Force role to user/assistant and sanitize — no injected system messages.
  const sanitized = messages.map((m) => ({
    role: (m.role === "assistant" ? "assistant" : "user") as
      | "user"
      | "assistant",
    content: sanitizeMessage(String(m.content ?? "")),
  }));

  const hasInjection = sanitized
    .filter((m) => m.role === "user")
    .some((m) => containsInjection(m.content));
  if (hasInjection) {
    return c.json({
      reply: "I can only help with your Leenar infrastructure.",
      actionsTaken: [],
    });
  }

  const totalLen = sanitized.reduce((n, m) => n + m.content.length, 0);
  if (totalLen > MAX_CONTENT_LEN) {
    return c.json({ error: "Message content too large" }, 429);
  }

  // One reserved slot covers the whole multi-step turn; tokens are summed and
  // recorded once after the run.
  const quota = await provisioningHooks.quota.reserve(userId, c.env);
  if (!quota.allowed) {
    if (quota.reason === "service_unavailable") {
      return c.json(
        { error: "AI service temporarily unavailable. Please try again." },
        503,
      );
    }
    const message =
      quota.reason === "global_daily_cap"
        ? "Service is temporarily unavailable. Please try again tomorrow."
        : quota.reason === "user_daily_cost_limit"
          ? "Daily AI usage limit reached. Resets at midnight UTC."
          : `Daily AI limit reached (${provisioningHooks.quota.dailyUserMsgLimit} messages/day). Resets at midnight UTC.`;
    return c.json({ error: message, quotaExceeded: true }, 429);
  }

  let result;
  try {
    result = await runAgent({
      messages: sanitized,
      userId,
      env: c.env,
      scope: "canvas",
      projectId,
      language: detectLangFromContent(sanitized),
      source: "web",
      workingCanvas: {
        nodes: canvas.nodes as never[],
        edges: canvas.edges as never[],
      },
    });
  } catch (e) {
    // Refund the reserved slot so a transient OpenAI failure doesn't burn quota.
    await provisioningHooks.quota.release(userId, c.env);
    throw e;
  }

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

  return c.json({
    reply: result.reply,
    actionsTaken: result.actionsTaken,
    canvasUpdate: result.canvasUpdate,
    canvasPending: result.canvasPending,
  });
});
