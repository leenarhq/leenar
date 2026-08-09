import type { Env } from "./types";

const PRIVATE_IP = [
  /^localhost$/i,
  /^127\./, // 127.0.0.0/8 loopback
  /^10\./, // 10.0.0.0/8 RFC1918
  /^192\.168\./, // 192.168.0.0/16 RFC1918
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // 172.16.0.0/12 RFC1918
  /^169\.254\./, // 169.254.0.0/16 link-local
  /^0\./, // 0.0.0.0/8
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 100.64.0.0/10 CGNAT
  /^::1?$/, // ::1 and ::
  /^0:0:0:0:0:0:0:0$/, // all-zeros expanded IPv6
  /^fc00:/i, // ULA
  /^fe80:/i, // link-local IPv6
  /^::ffff:/i, // IPv4-mapped IPv6
  /^\[/, // bracket-enclosed IPv6
  /^\d+$/, // decimal-encoded IPv4 (e.g. 2130706433)
  /^0x[\da-f]+$/i, // hex-encoded IPv4 (e.g. 0x7f000001)
];

// Resolves `host` via Cloudflare DNS-over-HTTPS and returns every A/AAAA
// address found. Used so isSafeWebhookUrl can block domains that merely
// *resolve* to a private/internal IP, not just literal IP hostnames.
async function resolveHost(host: string): Promise<string[]> {
  const query = async (type: "A" | "AAAA") => {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
      { headers: { Accept: "application/dns-json" } },
    );
    if (!res.ok) return [];
    const { Answer } = await res.json<{ Answer?: { data: string }[] }>();
    return (Answer ?? []).map((a) => a.data);
  };
  const [a, aaaa] = await Promise.all([query("A"), query("AAAA")]);
  return [...a, ...aaaa];
}

// Blocks both literal private/internal IP hostnames AND domain names whose
// DNS records point at a private/internal IP (a fresh lookup is required —
// see dispatchWebhooks, which re-validates at send time to close the window
// between registration and delivery).
export async function isSafeWebhookUrl(url: string): Promise<boolean> {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase().replace(/\.$/, "");
    if (PRIVATE_IP.some((p) => p.test(host))) return false;

    // Host is already a bare IP literal (e.g. "203.0.113.5") — nothing to resolve.
    if (/^[\d.]+$/.test(host) || /^\[.*\]$/.test(host) || host.includes(":")) return true;

    const addresses = await resolveHost(host);
    if (addresses.length === 0) return false; // fail closed: unresolvable host
    return addresses.every((ip) => !PRIVATE_IP.some((p) => p.test(ip.toLowerCase())));
  } catch {
    return false;
  }
}

export async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return (
    "sha256=" +
    [...new Uint8Array(buf)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

export type WebhookEvent =
  | "deploy_succeeded"
  | "deploy_failed"
  | "drift_detected"
  | "autopilot_action_taken"
  | "autopilot_needs_approval";

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  workflowId: string;
  stackId: string;
  projectName: string;
  error?: string;
}

export function isSlackUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "hooks.slack.com";
  } catch {
    return false;
  }
}

export function buildSlackBody(
  event: WebhookEvent,
  data: Record<string, unknown>,
  test?: boolean,
): string {
  let icon: string, title: string, lines: string[];

  if (event === "drift_detected") {
    const n = (data.newDrifts as number | undefined) ?? 1;
    icon = "⚠️";
    title = `Stack drift detected (${n} new)`;
    lines = [`${icon} *${title}*`, `*Workflow:* \`${data.workflowId ?? ""}\``];
  } else if (event === "autopilot_action_taken") {
    icon = "🤖"; title = `Autopilot executed: ${data.actionType ?? "action"}`;
    lines = [`${icon} *${title}*`, `*Project:* \`${data.projectId ?? ""}\``];
  } else if (event === "autopilot_needs_approval") {
    icon = "⚠️"; title = `Autopilot needs approval: ${data.actionType ?? "action"}`;
    lines = [`${icon} *${title}*`, `*Project:* \`${data.projectId ?? ""}\``];
  } else {
    const succeeded = event === "deploy_succeeded";
    icon = succeeded ? "✅" : "❌";
    title = succeeded ? "Deploy succeeded" : "Deploy failed";
    lines = [`${icon} *${title}*`, `*Project:* \`${data.projectName ?? ""}\``];
    if (data.error) lines.push(`*Error:* ${data.error}`);
  }

  if (test) lines.push("_This is a test message from Leenar._");
  return JSON.stringify({
    text: `${icon} ${title}`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
    ],
  });
}

export async function dispatchWebhooks(
  env: Env,
  userId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  const sbH = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  };
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_webhooks?user_id=eq.${userId}&active=eq.true&select=url,secret,events`,
    { headers: sbH },
  ).catch(() => null);
  if (!res?.ok) return;

  const webhooks = (await res.json()) as Array<{
    url: string;
    secret: string;
    events: string[];
  }>;
  const matching = webhooks.filter((wh) => wh.events.includes(event));
  if (matching.length === 0) return;

  // Re-validate at send time, not just at registration — the target's DNS
  // may have changed since the webhook was created.
  const safety = await Promise.all(matching.map((wh) => isSafeWebhookUrl(wh.url)));
  const safe = matching.filter((_, i) => safety[i]);
  if (safe.length === 0) return;

  const leenarBody = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    ...data,
  });

  await Promise.allSettled(
    safe.map(async (wh) => {
      const slack = isSlackUrl(wh.url);
      const body = slack ? buildSlackBody(event, data) : leenarBody;
      const sig = await sign(wh.secret, body);
      const doSend = () =>
        fetch(wh.url, {
          method: "POST",
          redirect: "manual",
          headers: {
            "Content-Type": "application/json",
            "X-Leenar-Signature": sig,
            "X-Leenar-Event": event,
            "User-Agent": "Leenar-Webhook/1.0",
          },
          body,
          signal: AbortSignal.timeout(3000),
        });
      try {
        const res = await doSend();
        // Retry once on server errors
        if (!res.ok && res.status >= 500) {
          await new Promise((r) => setTimeout(r, 500));
          await doSend().catch(() => {});
        }
      } catch {
        // Retry once on network/timeout errors
        await new Promise((r) => setTimeout(r, 500));
        await doSend().catch(() => {});
      }
    }),
  );
}
