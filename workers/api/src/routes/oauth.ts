import { Hono } from "hono";
import type { Env } from "../types";
import { encrypt } from "../crypto";
import { createLogger } from "../logger";
import { auditLog } from "../utils";

const log = createLogger({ route: "oauth" });

export async function hmacSign(payload: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(payload),
  );
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function hmacVerify(
  payload: string,
  sig: string,
  key: string,
): Promise<boolean> {
  try {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(key),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const sigBytes = Uint8Array.from(atob(sig), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify(
      "HMAC",
      cryptoKey,
      sigBytes,
      new TextEncoder().encode(payload),
    );
  } catch {
    return false;
  }
}

const ALLOWED_RETURN_PREFIXES = [
  "/dashboard",
  "/workspace",
  "/integrations",
  "/settings",
];

export function safeReturnPath(raw: string): string {
  if (!raw || !raw.startsWith("/")) return "/";
  try {
    const u = new URL(raw, "http://x");
    if (u.host !== "x") return "/";
    const p = u.pathname;
    if (p.includes("..") || p.includes("//")) return "/";
    return ALLOWED_RETURN_PREFIXES.some(
      (pre) => p === pre || p.startsWith(pre + "/"),
    )
      ? p + u.search
      : "/";
  } catch {
    return "/";
  }
}

const VERCEL_AUTH_URL = "https://vercel.com/oauth/authorize";
const VERCEL_TOKEN_URL = "https://api.vercel.com/v2/oauth/access_token";
const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const SUPABASE_AUTH_URL = "https://api.supabase.com/v1/oauth/authorize";
const SUPABASE_TOKEN_URL = "https://api.supabase.com/v1/oauth/token";

const SUPPORTED = ["vercel", "github", "supabase"] as const;
type Service = (typeof SUPPORTED)[number];

export const oauth = new Hono<{
  Bindings: Env;
  Variables: { userId: string };
}>();

// POST /oauth/:service/start  →  return provider auth URL as JSON (token via Authorization header)
oauth.post("/:service/start", async (c) => {
  const svc = c.req.param("service") as Service;
  if (!SUPPORTED.includes(svc))
    return c.json({ error: "Unsupported service" }, 400);

  const userId = c.get("userId");
  const body = await c.req
    .json<{ returnTo?: string }>()
    .catch(() => ({ returnTo: undefined }));
  const returnTo = safeReturnPath(body.returnTo ?? "");
  const nonce = crypto.randomUUID();
  const payload = JSON.stringify({
    svc,
    userId,
    returnTo,
    ts: Date.now(),
    nonce,
  });
  const sig = await hmacSign(payload, c.env.STATE_SIGNING_SECRET);
  const state = `${btoa(payload)}.${sig}`;
  const origin = new URL(c.req.url).origin;
  const redirectUri = `${origin}/api/oauth/${svc}/callback`;

  let authUrl: URL;

  if (svc === "vercel") {
    authUrl = new URL(VERCEL_AUTH_URL);
    authUrl.searchParams.set("client_id", c.env.VERCEL_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", state);
  } else if (svc === "supabase") {
    authUrl = new URL(SUPABASE_AUTH_URL);
    authUrl.searchParams.set("client_id", c.env.SUPABASE_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("state", state);
  } else {
    // GitHub
    authUrl = new URL(GITHUB_AUTH_URL);
    authUrl.searchParams.set("client_id", c.env.GITHUB_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", "repo,read:user");
    authUrl.searchParams.set("state", state);
  }

  return c.json({ url: authUrl.toString() });
});

// GET /oauth/:service/callback  →  exchange code, store encrypted token
oauth.get("/:service/callback", async (c) => {
  const svc = c.req.param("service") as Service;
  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) return c.json({ error: "Missing code or state" }, 400);

  let stateData: { svc: string; userId: string; returnTo?: string; ts: number };
  try {
    const dotIdx = state.lastIndexOf(".");
    if (dotIdx === -1) return c.json({ error: "Invalid state" }, 400);
    const encodedPayload = state.slice(0, dotIdx);
    const sig = state.slice(dotIdx + 1);
    const payload = atob(encodedPayload);
    const valid = await hmacVerify(payload, sig, c.env.STATE_SIGNING_SECRET);
    if (!valid) return c.json({ error: "State signature invalid" }, 400);
    stateData = JSON.parse(payload);
  } catch {
    return c.json({ error: "Invalid state" }, 400);
  }

  // Reject states older than 10 minutes or with future timestamps (1 min skew tolerance)
  if (stateData.ts > Date.now() + 60_000)
    return c.json({ error: "State timestamp invalid" }, 400);
  if (Date.now() - stateData.ts > 10 * 60 * 1000)
    return c.json({ error: "State expired" }, 400);

  if (stateData.svc !== svc) return c.json({ error: "State mismatch" }, 400);

  // Enforce one-time-use: reject replays within the 10-min validity window
  const stateHashBuf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(state),
  );
  const stateHash = btoa(String.fromCharCode(...new Uint8Array(stateHashBuf)));
  const sbHeaders = {
    "Content-Type": "application/json",
    apikey: c.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${c.env.SUPABASE_SERVICE_ROLE_KEY}`,
  };
  // Atomic one-time-use: INSERT first; UNIQUE constraint on hash causes a 409
  // conflict for concurrent replays instead of both passing a read-then-write check.
  const insertRes = await fetch(
    `${c.env.SUPABASE_URL}/rest/v1/used_oauth_states`,
    {
      method: "POST",
      headers: { ...sbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({
        hash: stateHash,
        expires_at: new Date(stateData.ts + 10 * 60 * 1000).toISOString(),
      }),
    },
  );
  if (insertRes.status === 409)
    return c.json({ error: "State already used" }, 400);
  if (!insertRes.ok) return c.json({ error: "State validation failed" }, 500);
  // Piggyback cleanup: purge expired states so the table doesn't grow unboundedly
  fetch(`${c.env.SUPABASE_URL}/rest/v1/rpc/cleanup_expired_oauth_states`, {
    method: "POST",
    headers: { ...sbHeaders, Prefer: "return=minimal" },
    body: "{}",
  }).catch(() => {
    /* non-critical, ignore errors */
  });

  // The one-time-use state marker is inserted above BEFORE the token exchange and
  // connection store. If anything below fails, release the marker so the user can
  // retry the OAuth flow — otherwise the burned marker returns 409 forever and any
  // successfully-issued provider token is discarded. Only keep it once committed.
  const releaseState = () =>
    fetch(
      `${c.env.SUPABASE_URL}/rest/v1/used_oauth_states?hash=eq.${encodeURIComponent(stateHash)}`,
      { method: "DELETE", headers: { ...sbHeaders, Prefer: "return=minimal" } },
    ).catch(() => {});
  let committed = false;
  try {
  const origin = new URL(c.req.url).origin;
  const redirectUri = `${origin}/api/oauth/${svc}/callback`;

  // Exchange code for token
  let accessToken: string;
  let refreshToken: string | undefined;
  let expiresIn: number | undefined;

  if (svc === "vercel") {
    const res = await fetch(VERCEL_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: c.env.VERCEL_CLIENT_ID,
        client_secret: c.env.VERCEL_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!res.ok) return c.json({ error: "Token exchange failed" }, 502);
    const data = (await res.json()) as { access_token: string };
    if (!data.access_token) return c.json({ error: "Token exchange failed: no access_token" }, 502);
    accessToken = data.access_token;
  } else if (svc === "supabase") {
    // Supabase uses HTTP Basic auth for token exchange
    const credentials = btoa(
      `${c.env.SUPABASE_CLIENT_ID}:${c.env.SUPABASE_CLIENT_SECRET}`,
    );
    const res = await fetch(SUPABASE_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!res.ok) {
      log.error("token_exchange_failed", { status: res.status });
      return c.json({ error: "Token exchange failed" }, 502);
    }
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) return c.json({ error: "Token exchange failed: no access_token" }, 502);
    accessToken = data.access_token;
    refreshToken = data.refresh_token;
    expiresIn = data.expires_in;
  } else {
    // GitHub
    const res = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: c.env.GITHUB_CLIENT_ID,
        client_secret: c.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!res.ok) return c.json({ error: "Token exchange failed" }, 502);
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) return c.json({ error: "Token exchange failed: no access_token" }, 502);
    accessToken = data.access_token;
    refreshToken = data.refresh_token;
    expiresIn = data.expires_in;
  }

  // Encrypt and store
  const encryptedAccess = await encrypt(accessToken, c.env.ENCRYPTION_KEY);
  const encryptedRefresh = refreshToken
    ? await encrypt(refreshToken, c.env.ENCRYPTION_KEY)
    : null;
  const expiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  const sbRes = await fetch(
    `${c.env.SUPABASE_URL}/rest/v1/user_connections?on_conflict=user_id,service`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: c.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${c.env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        user_id: stateData.userId,
        service: svc,
        access_token_enc: encryptedAccess,
        refresh_token_enc: encryptedRefresh,
        expires_at: expiresAt,
      }),
    },
  );

  if (!sbRes.ok) return c.json({ error: "Failed to save connection" }, 500);

  committed = true;
  auditLog(c.env, stateData.userId, "integration_connected", { service: svc });
  const safeReturn = safeReturnPath(stateData.returnTo ?? "/");
  return c.redirect(`${c.env.FRONTEND_URL}${safeReturn}?connected=${svc}`);
  } finally {
    if (!committed) await releaseState();
  }
});

const TOKEN_CONNECTABLE = ["github", "vercel", "supabase", "resend", "cloudflare"] as const;

// Shared logic — used by both the REST route and the MCP `connect_service` tool.
// Token/PAT-based connect only (not browser OAuth start/callback).
export async function connectServiceWithToken(
  service: string,
  token: string,
  userId: string,
  env: Env,
): Promise<{ error: string; status: 400 | 500 } | { ok: true; service: string }> {
  if (!(TOKEN_CONNECTABLE as readonly string[]).includes(service)) {
    return { error: "Invalid service", status: 400 };
  }
  if (!token) return { error: "token required", status: 400 };

  const encryptedAccess = await encrypt(token, env.ENCRYPTION_KEY);

  const saveRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_connections?on_conflict=user_id,service`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        user_id: userId,
        service,
        access_token_enc: encryptedAccess,
        // PATs have no expiry/refresh. Explicitly null these out so a stale
        // OAuth expires_at from a previous connection can't make getUserToken
        // treat the fresh PAT as expired (and clobber it via token refresh).
        refresh_token_enc: null,
        expires_at: null,
      }),
    },
  );

  if (!saveRes.ok) {
    log.error("token.save_failed", { service, status: saveRes.status });
    return { error: "Failed to save token", status: 500 };
  }

  auditLog(env, userId, "integration_connected", {
    service,
    method: "token",
  });
  return { ok: true, service };
}

// POST /oauth/:service/token  →  save a personal access token (non-OAuth services)
oauth.post("/:service/token", async (c) => {
  const svc = c.req.param("service");
  const userId = c.get("userId");
  const { token } = await c.req.json<{ token: string }>();
  const result = await connectServiceWithToken(svc, token, userId, c.env);
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

const DISCONNECTABLE = [...SUPPORTED, "resend", "cloudflare"] as const;

// Shared logic — used by both the REST route and the MCP `disconnect_service` tool.
export async function disconnectService(
  service: string,
  userId: string,
  env: Env,
): Promise<{ error: string; status: 400 | 502 } | { ok: true; service: string }> {
  if (!(DISCONNECTABLE as readonly string[]).includes(service))
    return { error: "Unsupported service", status: 400 };

  const delRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_connections?user_id=eq.${userId}&service=eq.${service}`,
    {
      method: "DELETE",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!delRes.ok) {
    log.error("disconnect.failed", { service, status: delRes.status });
    return { error: "Failed to disconnect service", status: 502 };
  }
  auditLog(env, userId, "integration_disconnected", { service });
  return { ok: true, service };
}

// DELETE /oauth/:service  →  disconnect
oauth.delete("/:service", async (c) => {
  const svc = c.req.param("service");
  const userId = c.get("userId");
  const result = await disconnectService(svc, userId, c.env);
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

// Shared logic — used by both the REST route and the MCP `list_connections` tool.
export async function listConnections(
  userId: string,
  env: Env,
): Promise<Array<{ service: string; expires_at: string | null; connected_at: string }>> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_connections?user_id=eq.${userId}&select=service,expires_at,connected_at`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// GET /oauth/connections  →  list connected services (no tokens)
oauth.get("/connections", async (c) => {
  const userId = c.get("userId");
  const data = await listConnections(userId, c.env);
  return c.json(data);
});
