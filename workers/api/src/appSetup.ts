import { Hono } from "hono";
import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";
import * as Sentry from "@sentry/cloudflare";
import type { Env } from "./types";
import { verifyJWT, bearerToken, classifyAuthFailure } from "./auth";
import { shouldMarkAuthSuccess, AUTH_SUCCESS_THROTTLE_MS } from "./authSuccess";
import { securityWeight } from "./securityScore";
import { verifyApiKey } from "./routes/apiKeys";
import { systemQuery } from "./tenancy";
import { createLogger } from "./logger";

const log = createLogger({ module: "appSetup" });

export type AppEnv = {
  Bindings: Env;
  Variables: {
    userId: string;
    userEmail: string;
    authMethod: "jwt" | "api_key";
    apiKeyScope: "read" | "write";
  };
};

export function createApp(cloudMiddleware: MiddlewareHandler[] = []): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(
    "*",
    cors({
      origin: (origin, c) => {
        if (!origin) return null;
        // Allowlist from env: CORS_ALLOWED_ORIGINS (comma-separated) if set,
        // otherwise the single FRONTEND_URL. Keeps self-host installs working
        // out of the box without hardcoding any deployment's origin.
        const allowed = ((c.env.CORS_ALLOWED_ORIGINS ??
          c.env.FRONTEND_URL ??
          "") as string)
          .split(",")
          .map((o: string) => o.trim())
          .filter(Boolean);
        if (allowed.includes(origin)) return origin;
        // Reflect localhost dev origins only outside production — never ship the
        // localhost allowance in the prod worker.
        if (
          c.env.SENTRY_ENVIRONMENT !== "production" &&
          (origin.startsWith("http://localhost:") ||
            origin.startsWith("http://127.0.0.1:"))
        )
          return origin;
        return null;
      },
      allowHeaders: ["Authorization", "Content-Type", "X-Confirm-Delete", "X-Confirm-Rollback"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    }),
  );

  for (const mw of cloudMiddleware) app.use("/api/*", mw);

  // Per-isolate throttle for the authenticated-IP allowlist marker (see authSuccess.ts).
  const authSuccessSeen = new Map<string, number>();

  // Strip allow-credentials when no origin was matched by the CORS middleware
  app.use("*", async (c, next) => {
    await next();
    if (!c.res.headers.get("access-control-allow-origin")) {
      c.res.headers.delete("access-control-allow-credentials");
    }
  });

  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("X-Frame-Options", "DENY");
    c.res.headers.set(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'",
    );
  });

  // Health check
  app.get("/health", (c) => c.json({ ok: true }));

  // Global error handler — captures unhandled route errors to Sentry
  app.onError((err, c) => {
    log.error("unhandled_error", { err });
    return c.json({ error: "Internal server error" }, 500);
  });

  // Prevent CDN/proxy caching of all API responses
  app.use("/api/*", async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", "no-store");
  });

  // Auth middleware — applied to every /api/* route
  app.use("/api/*", async (c, next) => {
    // OAuth callbacks come from GitHub/Vercel — no JWT
    if (/^\/api\/oauth\/[^/]+\/callback$/.test(c.req.path)) return next();
    if (c.req.path === "/api/waitlist") return next();
    if (c.req.path === "/api/admin/send-reminder") return next();
    if (c.req.path === "/api/admin/send-launch") return next();
    if (c.req.path === "/api/admin/send-checkin") return next();
    if (c.req.path === "/api/admin/list-registered-users") return next();
    if (c.req.path === "/api/admin/run-uptime" && c.req.method === "POST") return next();
    if (c.req.path === "/api/notifications/unsubscribe" && c.req.method === "GET")
      return next();
    // Slack webhooks authenticate via request signature (not JWT), verified inside
    // the route handler against SLACK_SIGNING_SECRET.
    if (c.req.path.startsWith("/api/slack/") && c.req.method === "POST")
      return next();
    // WhatsApp (Meta Cloud API): GET is the verify-token handshake, POST is
    // signature-verified inside the handler against WHATSAPP_APP_SECRET. Scope the
    // bypass to those methods so a future route here isn't left unauthenticated.
    if (
      c.req.path.startsWith("/api/whatsapp/") &&
      (c.req.method === "GET" || c.req.method === "POST")
    )
      return next();

    const token = bearerToken(c.req.raw) ?? null;
    if (!token) return c.json({ error: "Unauthorized" }, 401);

    // lnr_ prefixed tokens are Leenar API keys — verify against api_keys table
    if (token.startsWith("lnr_")) {
      const result = await verifyApiKey(token, c.env);
      if (!result) return c.json({ error: "Invalid API key." }, 401);
      c.set("userId", result.userId);
      c.set("authMethod", "api_key");
      c.set("apiKeyScope", result.scope);
      // Tag audit rows with the transport channel (E4). Clone into a fresh env
      // object — never mutate the shared isolate bindings — so auditLog(c.env,…)
      // downstream reads it. A more specific agent/channel source (set later by
      // callTool/runAgent) overrides this default inside auditLog.
      c.env = { ...c.env, _auditChannel: "mcp" };
      Sentry.setUser({ id: result.userId });

      // Enforce read/write scope centrally across the REST surface. Read-scoped
      // keys may only perform safe (non-mutating) methods. /api/mcp and /api/agent
      // apply their own finer-grained per-tool scope checks, so exempt them here
      // and let those handlers gate writes.
      const path = c.req.path;
      const selfGated =
        path.startsWith("/api/mcp") || path.startsWith("/api/agent");
      if (
        result.scope !== "write" &&
        !selfGated &&
        !["GET", "HEAD", "OPTIONS"].includes(c.req.method)
      ) {
        return c.json(
          { error: "This API key is read-only. Use a key with write scope." },
          403,
        );
      }
      return next();
    }

    let result;
    try {
      result = await verifyJWT(
        token,
        c.env.SUPABASE_JWT_SECRET,
        c.env.SUPABASE_URL,
      );
    } catch (e) {
      // Infra error (e.g. JWKS fetch failure) — NOT attack traffic, never logged.
      log.error("auth.verify_error", { err: (e as Error).message });
      return c.json(
        { error: "Authentication temporarily unavailable. Please try again.", code: "auth_error" },
        401,
      );
    }

    if (result.ok) {
      c.set("userId", result.payload.sub);
      c.set("userEmail", result.payload.email ?? "");
      c.set("authMethod", "jwt");
      // Tag audit rows as web (E4). Clone into a fresh env object so auditLog
      // reads it downstream; a specific agent/channel source (web dashboard
      // agent, etc.) still overrides this inside auditLog when set.
      c.env = { ...c.env, _auditChannel: "web" };
      Sentry.setUser({ id: result.payload.sub });

      // Allowlist marker: record this IP as holding a live session so securityCheck
      // never edge-bans it. Throttled per-isolate; runs in waitUntil so it lands
      // without adding latency to the response.
      // Trust ONLY Cloudflare's CF-Connecting-IP — X-Forwarded-For is
      // attacker-controlled if the Worker is reached directly, and this row
      // allowlists the IP from auto-bans. No trusted IP → skip the marker.
      const ip = c.req.header("CF-Connecting-IP");
      if (ip && shouldMarkAuthSuccess(ip, Date.now(), authSuccessSeen, AUTH_SUCCESS_THROTTLE_MS)) {
        c.executionCtx.waitUntil(
          systemQuery(c.env, "security_events", {
            method: "POST",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({
              ip,
              method: c.req.method,
              path: new URL(c.req.url).pathname,
              user_agent: c.req.header("User-Agent") ?? null,
              country: c.req.header("CF-IPCountry") ?? null,
              reason: "auth_success",
              weight: 0,
              blocked: false,
            }),
          }).then(() => {}, () => {}),
        );
      }
      return next();
    }

    const cls = classifyAuthFailure(result.reason);
    if (cls.logAsSecurityEvent) {
      systemQuery(c.env, "security_events", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          ip: c.req.header("CF-Connecting-IP") ?? "unknown",
          method: c.req.method,
          path: new URL(c.req.url).pathname,
          user_agent: c.req.header("User-Agent") ?? null,
          country: c.req.header("CF-IPCountry") ?? null,
          reason: cls.securityReason,
          weight: securityWeight(cls.securityReason),
          blocked: true,
        }),
      }).catch(() => {});
    }
    return c.json(
      { error: "Invalid or expired token. Please sign in again.", code: cls.responseCode },
      401,
    );
  });

  return app;
}

export const sentryOptions = (env: Env) => ({
  dsn: env.SENTRY_DSN,
  environment: env.SENTRY_ENVIRONMENT ?? "production",
  // 100% for provision/chat critical paths; 10% for everything else
  tracesSampler: ({ name }: { name: string }) =>
    name.includes("/api/provision") || name.includes("/api/chat") ? 1.0 : 0.1,
});
