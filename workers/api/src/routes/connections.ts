import { Hono } from "hono";
import type { Env } from "../types";
import { decrypt } from "../crypto";
import { getUserToken } from "../utils";
import { log } from "../logger";
import { getAccountId, getCloudflareWorkerErrors } from "../connectors/cloudflare";

export const connections = new Hono<{
  Bindings: Env;
  Variables: { userId: string };
}>();

type HealthStatus = "valid" | "expired" | "invalid";

interface HealthResult {
  status: HealthStatus;
  checkedAt: string;
  incidentsReady?: boolean; // cloudflare only: token has Account Analytics:Read
  account?: string;
  accountDetail?: string;
}

type Ping = { status: HealthStatus; account?: string; accountDetail?: string };

async function pingGitHub(token: string): Promise<Ping> {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "Leenar/1.0" },
  });
  if (res.status === 401) return { status: "expired" };
  if (!res.ok) return { status: "invalid" };
  try {
    const u = (await res.json()) as { login?: string; name?: string };
    return u?.login
      ? { status: "valid", account: `@${u.login}`, accountDetail: u.name || undefined }
      : { status: "valid" };
  } catch {
    return { status: "valid" };
  }
}

async function pingVercel(token: string): Promise<Ping> {
  const res = await fetch("https://api.vercel.com/v2/user", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 403) return { status: "expired" };
  if (!res.ok) return { status: "invalid" };
  try {
    const d = (await res.json()) as {
      user?: { username?: string; email?: string; name?: string };
    };
    const u = d?.user;
    const account = u?.username || u?.name;
    return account
      ? { status: "valid", account, accountDetail: u?.email || undefined }
      : { status: "valid" };
  } catch {
    return { status: "valid" };
  }
}

async function fetchSupabaseOrg(token: string): Promise<string | undefined> {
  try {
    const res = await fetch("https://api.supabase.com/v1/organizations", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return undefined;
    const orgs = (await res.json()) as Array<{ name?: string }>;
    if (!Array.isArray(orgs) || orgs.length === 0) return undefined;
    const first = orgs[0]?.name;
    if (!first) return undefined;
    return orgs.length > 1 ? `${first} +${orgs.length - 1}` : first;
  } catch {
    return undefined;
  }
}

async function pingSupabase(token: string): Promise<Ping> {
  const res = await fetch("https://api.supabase.com/v1/projects", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 403) return { status: "expired" };
  if (!res.ok) return { status: "invalid" };
  return { status: "valid", account: await fetchSupabaseOrg(token) };
}

async function pingResend(token: string): Promise<Ping> {
  const res = await fetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 403) return { status: "valid" }; // valid key, limited perms
  if (res.status === 401) return { status: "expired" };
  if (!res.ok) return { status: "invalid" };
  return { status: "valid" };
}

/** True when the token can read Workers analytics (Account Analytics:Read). */
async function cloudflareIncidentsReady(token: string): Promise<boolean> {
  try {
    const accountId = await getAccountId(token);
    const probe = await getCloudflareWorkerErrors(
      token,
      accountId,
      "__leenar_probe__", // non-existent script: a valid scope still returns ok/empty
      Date.now() - 5 * 60_000,
    );
    return probe.status === "ok";
  } catch {
    return false;
  }
}

async function fetchCloudflareAccount(token: string): Promise<string | undefined> {
  try {
    const res = await fetch("https://api.cloudflare.com/client/v4/accounts", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return undefined;
    const d = (await res.json()) as { result?: Array<{ name?: string }> };
    const accts = d?.result ?? [];
    const first = accts[0]?.name;
    if (!first) return undefined;
    return accts.length > 1 ? `${first} +${accts.length - 1}` : first;
  } catch {
    return undefined;
  }
}

async function pingCloudflare(token: string): Promise<Ping> {
  const res = await fetch(
    "https://api.cloudflare.com/client/v4/user/tokens/verify",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.status === 401 || res.status === 403) return { status: "expired" };
  if (!res.ok) return { status: "invalid" };
  const data = (await res.json()) as { result?: { status?: string } };
  if (data.result?.status !== "active") return { status: "expired" };
  return { status: "valid", account: await fetchCloudflareAccount(token) };
}

/**
 * Why every outcome carries a distinct reason: a 403 from Vercel means the token
 * cannot reach the account's scope, which is a completely different fix from
 * "the Vercel GitHub App isn't installed". Folding both into `false` sent users
 * to github.com/apps/vercel to install an app that was already there, while the
 * thing that actually fixed it — reconnecting Vercel — was never suggested.
 */
export type VercelGitHubReason =
  | "linked"
  | "not_linked"
  | "auth_failed"
  | "check_failed";

async function probeVercelGitHub(
  token: string,
): Promise<{ linked: boolean; reason: VercelGitHubReason }> {
  let res: Response;
  try {
    res = await fetch(
      "https://api.vercel.com/v1/integrations/git-namespaces?provider=github",
      { headers: { Authorization: `Bearer ${token}` } },
    );
  } catch (e) {
    log.warn("vercel_github.probe_threw", {
      error: e instanceof Error ? e.message : String(e),
    });
    return { linked: false, reason: "check_failed" };
  }

  if (!res.ok) {
    const authFailed = res.status === 401 || res.status === 403;
    log.warn("vercel_github.probe_http_error", {
      status: res.status,
      body: await res.text().then((t) => t.slice(0, 300)).catch(() => ""),
    });
    return { linked: false, reason: authFailed ? "auth_failed" : "check_failed" };
  }

  let namespaces: Array<{ slug?: string }>;
  try {
    const data = (await res.json()) as
      | { namespaces?: Array<{ slug?: string }> }
      | Array<{ slug?: string }>;
    namespaces = Array.isArray(data) ? data : (data?.namespaces ?? []);
  } catch {
    return { linked: false, reason: "check_failed" };
  }

  log.info("vercel_github.probe", {
    namespaceCount: namespaces.length,
    slugs: namespaces.map((n) => n?.slug).filter(Boolean).slice(0, 20),
  });
  return namespaces.length > 0
    ? { linked: true, reason: "linked" }
    : { linked: false, reason: "not_linked" };
}

connections.get("/vercel-github", async (c) => {
  const userId = c.get("userId");
  const sbH = {
    apikey: c.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${c.env.SUPABASE_SERVICE_ROLE_KEY}`,
  };

  const [vercelRows, githubRows] = await Promise.all([
    fetch(
      `${c.env.SUPABASE_URL}/rest/v1/user_connections?user_id=eq.${userId}&service=eq.vercel&select=access_token_enc&limit=1`,
      { headers: sbH },
    ).then((r) => r.json()) as Promise<Array<{ access_token_enc: string }>>,
    fetch(
      `${c.env.SUPABASE_URL}/rest/v1/user_connections?user_id=eq.${userId}&service=eq.github&select=access_token_enc&limit=1`,
      { headers: sbH },
    ).then((r) => r.json()) as Promise<Array<{ access_token_enc: string }>>,
  ]);

  let vercelHasGitHub = false;
  let githubHasVercel = false;
  // No Vercel row at all is its own outcome — nothing to probe, and the fix is
  // "connect Vercel", not anything to do with GitHub.
  let reason: VercelGitHubReason | "no_connection" = "no_connection";

  if (vercelRows.length) {
    try {
      const token = await decrypt(
        vercelRows[0].access_token_enc,
        c.env.ENCRYPTION_KEY,
      );
      const probe = await probeVercelGitHub(token);
      vercelHasGitHub = probe.linked;
      reason = probe.reason;
    } catch (e) {
      // decrypt failed — the stored token is unusable, same user-facing fix as
      // an auth failure: reconnect Vercel.
      reason = "auth_failed";
      log.warn("vercel_github.decrypt_failed", {
        userId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (githubRows.length) {
    try {
      const token = await decrypt(
        githubRows[0].access_token_enc,
        c.env.ENCRYPTION_KEY,
      );
      const res = await fetch(
        "https://api.github.com/user/installations?per_page=100",
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": "Leenar/1.0",
            Accept: "application/vnd.github+json",
          },
        },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          installations?: Array<{ app_slug: string }>;
        };
        githubHasVercel = (data.installations ?? []).some(
          (inst) => inst.app_slug === "vercel",
        );
      }
    } catch {
      /* ignore */
    }
  }

  // linked is determined by Vercel side only — GitHub OAuth token can't reliably list app installations
  log.info("vercel_github.result", {
    userId,
    linked: vercelHasGitHub,
    reason,
    githubHasVercel,
    hasGithubRow: githubRows.length > 0,
  });
  return c.json({
    linked: vercelHasGitHub,
    reason,
    vercelHasGitHub,
    githubHasVercel,
  });
});

connections.get("/health", async (c) => {
  const userId = c.get("userId");

  // Fetch the list of connected services (no tokens — we'll get them via getUserToken
  // which handles auto-refresh for expired OAuth tokens before pinging the service).
  const res = await fetch(
    `${c.env.SUPABASE_URL}/rest/v1/user_connections?user_id=eq.${userId}&select=service`,
    {
      headers: {
        apikey: c.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${c.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  const rows = (await res.json()) as Array<{ service: string }>;

  const checkedAt = new Date().toISOString();
  const result: Record<string, HealthResult> = {};

  await Promise.all(
    rows.map(async (row) => {
      try {
        // getUserToken handles OAuth refresh (e.g. Supabase 1h tokens) before returning.
        const token = await getUserToken(c.env, userId, row.service);
        let ping: { status: HealthStatus; account?: string; accountDetail?: string };
        if (row.service === "github") ping = await pingGitHub(token);
        else if (row.service === "vercel") ping = await pingVercel(token);
        else if (row.service === "supabase") ping = await pingSupabase(token);
        else if (row.service === "resend") ping = await pingResend(token);
        else if (row.service === "cloudflare") {
          ping = await pingCloudflare(token);
          if (ping.status === "valid") {
            const ready = await cloudflareIncidentsReady(token);
            result[row.service] = { ...ping, checkedAt, incidentsReady: ready };
            return;
          }
        } else {
          // Unknown service in DB — skip without calling getUserToken
          result[row.service] = { status: "invalid", checkedAt };
          return;
        }
        result[row.service] = { ...ping, checkedAt };
      } catch {
        result[row.service] = { status: "invalid", checkedAt };
      }
    }),
  );

  return c.json(result);
});

export const __test = { pingGitHub, pingVercel, pingSupabase, pingResend, pingCloudflare, probeVercelGitHub };
