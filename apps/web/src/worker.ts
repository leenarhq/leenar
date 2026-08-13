import handler from "@tanstack/react-start/server-entry";
import { clientIp } from "./clientIp";
import { maintenanceResponse } from "./edgeMaintenance";
import { feedResponse } from "./lib/feeds";

// Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + API_URL in Cloudflare → Settings → Variables.
// API_URL is the origin the SPA calls; the CSP connect-src must allow it, so it
// is read from env rather than hardcoded (keeps self-host installs working).
// SUPABASE_URL feeds connect-src for the same reason: the `https://*.supabase.co`
// wildcard below only covers hosted Supabase, so a self-host install (Kong on
// http://localhost:8000) would have every supabase-js call blocked by CSP
// before it ever reaches the network.
interface PagesEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  API_URL?: string;
  [key: string]: string | undefined;
}

const OTHER_SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

// connect-src entries for the configured Supabase origin, both HTTP (auth/rest)
// and WebSocket (realtime). Empty when unset or unparseable — on hosted Supabase
// this is redundant with the `https://*.supabase.co` wildcard, so emitting
// nothing is always safe.
function supabaseConnectSrc(supabaseUrl: string): string {
  if (!supabaseUrl) return "";
  try {
    const { origin, host, protocol } = new URL(supabaseUrl);
    const ws = protocol === "https:" ? "wss:" : "ws:";
    return ` ${origin} ${ws}//${host}`;
  } catch {
    return "";
  }
}

function buildCSP(
  nonce: string,
  apiOrigin: string,
  supabaseOrigin: string,
): string {
  // Extra connect-src entry for the configured API origin (empty when same-origin
  // or unset — 'self' already covers a same-origin API).
  const apiConnect = apiOrigin ? ` ${apiOrigin}` : "";
  const supabaseConnect = supabaseConnectSrc(supabaseOrigin);
  return [
    "default-src 'self'",
    // 'strict-dynamic' lets nonce-approved scripts load further chunks (Vite code-splitting).
    // 'self' + URL list kept as fallback for browsers that don't support strict-dynamic.
    // sha256-jOmm… = PostHog bootstrap inline <script> injected by the JS bundle
    `script-src 'strict-dynamic' 'self' 'nonce-${nonce}' 'sha256-jOmmqmxomJBxO/NsZQu3dUkEqPVmAhZIRwY3GFC0LkE=' https://*.i.posthog.com https://eu-assets.i.posthog.com https://challenges.cloudflare.com https://static.cloudflareinsights.com`,
    // sha256-47DE… = SHA256("") — empty <style> element; sha256-CIxD… = CSS-in-JS injected rule
    // fonts.googleapis.com serves the IBM Plex Sans <link rel="stylesheet"> in __root.tsx
    `style-src 'self' 'nonce-${nonce}' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=' 'sha256-CIxDM5jnsGiKqXs2v7NKCY5MzdR9gu6TtiMJrDw29AY=' https://fonts.googleapis.com`,
    // Animation libraries (Framer Motion etc.) inject inline style attributes —
    // nonces only cover <style> elements, not style="". Isolate to attr-only.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: https: blob:",
    // fonts.gstatic.com serves the actual woff2 files the googleapis.com stylesheet references
    "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com",
    `connect-src 'self'${apiConnect}${supabaseConnect} https://*.supabase.co wss://*.supabase.co https://*.ingest.de.sentry.io https://*.i.posthog.com https://eu.i.posthog.com https://challenges.cloudflare.com https://static.cloudflareinsights.com`,
    "frame-src https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

const assetCSP = (apiOrigin: string, supabaseOrigin: string): string =>
  buildCSP("static", apiOrigin, supabaseOrigin).replace(" 'nonce-static'", "");

const tsHandler = handler as any;

// Block mutating methods on Pages-served routes only.
// OPTIONS must never be blocked — it is used for CORS preflights to the API worker.
// /api/* paths are proxied to the API worker and must not be intercepted here.
const BLOCKED_METHODS = new Set(["PUT", "DELETE", "PATCH"]);

// Scanner/exploit path patterns — return 404 without revealing they were blocked
const BAD_PATH_RE = [
  /\.php(\?.*)?$/i,
  /\/wp-(?:admin|includes|content|login|cron|json)/i,
  /\/xmlrpc\.php/i,
  /\/\.env(\?.*)?$/i,
  /\/\.git\//i,
  /\/etc\/passwd/i,
  /\/proc\/self/i,
  /\/(?:shell|cmd|config\.bak|web\.config)(\?.*)?$/i,
  /\/(?:eval|system|exec|passthru|base64_decode)\(/i,
];

// Known scanner/exploit user-agents
const BAD_UA_RE = [
  /zgrab/i,
  /masscan/i,
  /nikto/i,
  /sqlmap/i,
  /dirbuster/i,
  /nuclei/i,
  /hydra/i,
];

function blockReason(path: string, ua: string): string | null {
  for (const re of BAD_PATH_RE) {
    if (re.test(path)) return "blocked_path";
  }
  // Skip UA check for static assets — bots fetching JS/CSS is not a threat
  if (!path.startsWith("/_app/") && !path.startsWith("/assets/")) {
    for (const re of BAD_UA_RE) {
      if (re.test(ua)) return "blocked_ua";
    }
  }
  return null;
}

function logSecurityEvent(
  env: PagesEnv,
  ctx: { waitUntil(p: Promise<unknown>): void },
  event: {
    ip: string;
    method: string;
    path: string;
    user_agent: string | null;
    country: string | null;
    reason: string;
  },
): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  ctx.waitUntil(
    fetch(`${env.SUPABASE_URL}/rest/v1/security_events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ ...event, blocked: true }),
    }).catch(() => {}),
  );
}

export default {
  async fetch(
    request: Request,
    env: unknown,
    ctx: { waitUntil(p: Promise<unknown>): void },
  ): Promise<Response> {
    const pagesEnv = env as PagesEnv;
    const apiOrigin = pagesEnv.API_URL ?? "";
    const supabaseOrigin = pagesEnv.SUPABASE_URL ?? "";
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();
    const ua = request.headers.get("User-Agent") ?? "";
    const ip = clientIp(request.headers);
    const country = request.headers.get("CF-IPCountry") ?? null;

    const maint = maintenanceResponse(request, pagesEnv);
    if (maint) return maint;

    // Block scanners/exploits before they touch the app
    const reason = blockReason(path, ua);
    if (reason) {
      logSecurityEvent(pagesEnv, ctx, {
        ip,
        method,
        path,
        user_agent: ua || null,
        country,
        reason,
      });
      return new Response("Not Found", { status: 404 });
    }

    // Only block mutating methods on Pages app paths.
    // API calls (/api/*) are routed to the API worker — never block them here.
    if (BLOCKED_METHODS.has(method) && !path.startsWith("/api/")) {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD, POST" },
      });
    }

    // The feeds are generated, not stored: both enumerate the blog posts, which
    // live as markdown in this bundle. Served here rather than as route
    // components because neither is HTML.
    const feed = feedResponse(path);
    if (feed) return feed;

    const response: Response = await tsHandler.fetch(request, env, ctx);
    const headers = new Headers(response.headers);

    // Remove headers that leak server/framework info
    headers.delete("X-Powered-By");
    headers.delete("Server");

    for (const [key, value] of Object.entries(OTHER_SECURITY_HEADERS)) {
      headers.set(key, value);
    }

    const ct = headers.get("content-type") ?? "";

    if (ct.includes("text/html")) {
      const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
      const nonce = btoa(String.fromCharCode(...nonceBytes));

      const html = await response.text();
      const patched = html
        .replace(/<script(\s|>)/g, `<script nonce="${nonce}"$1`)
        .replace(/<style(\s|>)/g, `<style nonce="${nonce}"$1`);

      headers.set(
        "Content-Security-Policy",
        buildCSP(nonce, apiOrigin, supabaseOrigin),
      );
      headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
      headers.set("Pragma", "no-cache");

      return new Response(patched, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    headers.set("Content-Security-Policy", assetCSP(apiOrigin, supabaseOrigin));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
