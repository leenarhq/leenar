import { redactSecretsFromText } from "../utils";
import { assertNotRateLimited } from "./errors";

const CF_API = "https://api.cloudflare.com/client/v4";

function cfHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/**
 * Combine a 30s timeout signal with an optional caller-supplied abort signal
 * (e.g. a Durable Object's `this.abortController.signal`) so callers can
 * cancel in-flight Cloudflare API calls on deploy timeout/cancel.
 * Feature-detects `AbortSignal.any` and falls back to manually wiring a
 * combined AbortController for runtimes where it's unavailable.
 */
export function signalMerge(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(30_000);
  if (!signal) return timeoutSignal;

  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([timeoutSignal, signal]);
  }

  // Fallback: manually combine signals for runtimes without AbortSignal.any
  const combined = new AbortController();
  const forward = (s: AbortSignal) => {
    if (s.aborted) {
      combined.abort(s.reason);
      return;
    }
    s.addEventListener("abort", () => combined.abort(s.reason), {
      once: true,
    });
  };
  forward(timeoutSignal);
  forward(signal);
  return combined.signal;
}

export async function getAccountId(
  token: string,
  opts?: { signal?: AbortSignal },
): Promise<string> {
  const res = await fetch(`${CF_API}/accounts?per_page=1`, {
    headers: cfHeaders(token),
    signal: signalMerge(opts?.signal),
  });
  if (!res.ok)
    throw new Error(
      `Cloudflare accounts fetch failed (${res.status}). Check your API token has Account:Read permission.`,
    );
  const data = (await res.json()) as { result?: Array<{ id: string }> };
  const account = data.result?.[0];
  if (!account)
    throw new Error("No Cloudflare account found. Verify your API token.");
  return account.id;
}

/** Fetch the account's `*.workers.dev` subdomain. Returns "" if unset/unavailable. */
export async function getWorkersSubdomain(
  token: string,
  accountId: string,
  opts?: { signal?: AbortSignal },
): Promise<string> {
  const res = await fetch(`${CF_API}/accounts/${accountId}/workers/subdomain`, {
    headers: cfHeaders(token),
    signal: signalMerge(opts?.signal),
  });
  if (!res.ok) return "";
  const data = (await res.json()) as { result?: { subdomain?: string } };
  return data.result?.subdomain ?? "";
}

function slugify(name: string, fallback: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63) || fallback
  );
}

export interface CloudflareR2Output {
  cloudflare_account_id: string;
  r2_bucket_name: string;
  r2_endpoint: string;
  r2_access_key_id: string;
  r2_secret_access_key: string;
  R2_BUCKET_NAME: string;
  R2_ENDPOINT: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  // Set to true when R2 API token creation failed — credentials must be added manually
  r2_credentials_pending?: boolean;
}

export async function provisionR2(
  token: string,
  accountId: string,
  bucketName: string,
  opts?: {
    locationHint?: string;
    signal?: AbortSignal;
  },
): Promise<CloudflareR2Output> {
  const slug = slugify(bucketName, "leenar-bucket");

  const bucketBody: Record<string, string> = { name: slug };
  if (opts?.locationHint) bucketBody.locationHint = opts.locationHint;

  const bucketRes = await fetch(`${CF_API}/accounts/${accountId}/r2/buckets`, {
    method: "POST",
    headers: cfHeaders(token),
    body: JSON.stringify(bucketBody),
    signal: signalMerge(opts?.signal),
  });
  if (!bucketRes.ok && bucketRes.status !== 409) {
    const rawBody = await bucketRes.text();
    const body = redactSecretsFromText(rawBody, [token]);
    console.error("[cloudflare] r2_bucket_create_failed", {
      status: bucketRes.status,
      body: body.slice(0, 300),
    });
    const hint =
      bucketRes.status === 403
        ? "R2 may not be enabled on your Cloudflare account — go to dash.cloudflare.com, open R2 Object Storage, and subscribe first. Then check your API token has R2:Edit permission."
        : "Check your Cloudflare API token has R2:Edit permission.";
    throw new Error(`R2 bucket creation failed (${bucketRes.status}). ${hint}`);
  }

  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;

  const tokenRes = await fetch(`${CF_API}/accounts/${accountId}/r2/tokens`, {
    method: "POST",
    headers: cfHeaders(token),
    body: JSON.stringify({
      name: `leenar-${slug}`,
      permissions: ["object-read-write"],
      buckets: [slug],
    }),
    signal: signalMerge(opts?.signal),
  });

  if (tokenRes.ok) {
    const tokenData = (await tokenRes.json()) as {
      result?: { accessKeyId?: string; secretAccessKey?: string };
    };
    const accessKeyId = tokenData.result?.accessKeyId;
    const secretKey = tokenData.result?.secretAccessKey;
    if (accessKeyId && secretKey) {
      return {
        cloudflare_account_id: accountId,
        r2_bucket_name: slug,
        r2_endpoint: endpoint,
        r2_access_key_id: accessKeyId,
        r2_secret_access_key: secretKey,
        R2_BUCKET_NAME: slug,
        R2_ENDPOINT: endpoint,
        R2_ACCESS_KEY_ID: accessKeyId,
        R2_SECRET_ACCESS_KEY: secretKey,
      };
    }
  }

  // Token creation not available via API (404) or returned no credentials.
  // Bucket is provisioned; credentials must be created manually in the CF dashboard:
  // R2 → Manage R2 API Tokens → Create API Token for bucket: ${slug}
  // Then add R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY as env vars.
  const rawTokenBody = tokenRes.ok ? "" : await tokenRes.text().catch(() => "");
  const tokenBody = redactSecretsFromText(rawTokenBody, [token]);
  console.warn("[cloudflare] r2_token_create_skipped", {
    status: tokenRes.status,
    bucket: slug,
    body: tokenBody.slice(0, 200),
    action: "bucket provisioned; credentials need manual setup in CF dashboard",
  });

  return {
    cloudflare_account_id: accountId,
    r2_bucket_name: slug,
    r2_endpoint: endpoint,
    // Empty strings are skipped by the provisioner's env-injection check (ctx[key] !== "")
    r2_access_key_id: "",
    r2_secret_access_key: "",
    R2_BUCKET_NAME: slug,
    R2_ENDPOINT: endpoint,
    R2_ACCESS_KEY_ID: "",
    R2_SECRET_ACCESS_KEY: "",
    r2_credentials_pending: true,
  };
}

/** List secret names currently set on a CF Worker (does not return values). */
export async function listWorkerSecrets(
  token: string,
  accountId: string,
  workerName: string,
): Promise<string[]> {
  const slug = encodeURIComponent(workerName);
  const res = await fetch(
    `${CF_API}/accounts/${accountId}/workers/scripts/${slug}/secrets`,
    { headers: cfHeaders(token), signal: AbortSignal.timeout(30_000) },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { result?: Array<{ name: string }> };
  return (data.result ?? []).map((s) => s.name);
}

/** Delete a single secret from a CF Worker. 404 = idempotent success. */
export async function deleteWorkerSecret(
  token: string,
  accountId: string,
  workerName: string,
  secretName: string,
): Promise<void> {
  const slug = encodeURIComponent(workerName);
  const res = await fetch(
    `${CF_API}/accounts/${accountId}/workers/scripts/${slug}/secrets/${encodeURIComponent(secretName)}`,
    {
      method: "DELETE",
      headers: cfHeaders(token),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok && res.status !== 404) {
    const rawBody = await res.text().catch(() => "");
    const body = redactSecretsFromText(rawBody, [token]);
    throw new Error(
      `Failed to delete CF Worker secret "${secretName}" (${res.status}): ${body.slice(0, 200)}`,
    );
  }
}

// Inject env vars as Worker Secrets (no script re-upload needed).
// Each call is a single PUT; failures are logged but don't abort.
export async function updateWorkerSecrets(
  token: string,
  accountId: string,
  workerName: string,
  secrets: Record<string, string>,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const slug = encodeURIComponent(workerName);
  const base = `${CF_API}/accounts/${accountId}/workers/scripts/${slug}/secrets`;
  const failed: string[] = [];
  const secretValues = Object.values(secrets).concat(token);
  await Promise.all(
    Object.entries(secrets).map(async ([name, text]) => {
      const res = await fetch(base, {
        method: "PUT",
        headers: { ...cfHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ name, text, type: "secret_text" }),
        signal: signalMerge(opts?.signal),
      });
      if (!res.ok) {
        const rawBody = await res.text().catch(() => "");
        const body = redactSecretsFromText(rawBody, secretValues);
        console.error("[cloudflare] secret_put_failed", {
          name,
          status: res.status,
          body: body.slice(0, 200),
        });
        failed.push(`"${name}" (${res.status})`);
      }
    }),
  );
  if (failed.length > 0) {
    throw new Error(`CF secret push failed for: ${failed.join(", ")}`);
  }
}

export async function deprovisionCloudflareWorker(
  token: string,
  accountId: string,
  workerName: string,
): Promise<void> {
  const res = await fetch(
    `${CF_API}/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}`,
    {
      method: "DELETE",
      headers: cfHeaders(token),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok && res.status !== 404) {
    const rawBody = await res.text().catch(() => "");
    const body = redactSecretsFromText(rawBody, [token]);
    console.error("[cloudflare] worker_delete_failed", {
      status: res.status,
      body: body.slice(0, 300),
    });
    throw new Error(
      `Worker deletion failed (${res.status}). Check your Cloudflare API token has Workers:Edit permission.`,
    );
  }
}

/** Roll back a Cloudflare Worker to a specific version by setting it to 100% traffic. */
export async function rollbackCloudflareWorker(
  token: string,
  accountId: string,
  workerName: string,
  versionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const slug = encodeURIComponent(workerName);
  const res = await fetch(
    `${CF_API}/accounts/${accountId}/workers/scripts/${slug}/deployments`,
    {
      method: "POST",
      headers: { ...cfHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        strategy: "percentage",
        versions: [{ version_id: versionId, percentage: 100 }],
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (res.status === 404) {
    return { ok: false, error: "worker or version not found" };
  }
  const data = await res
    .json<{ success?: boolean; errors?: Array<{ message: string }> }>()
    .catch(() => ({}));
  if ((data as any).success === true) {
    return { ok: true };
  }
  const cfMsg = (data as any).errors?.[0]?.message ?? `${res.status}`;
  return { ok: false, error: cfMsg };
}

/** List deployed versions of a Cloudflare Worker. Returns [] on any error. */
export async function listWorkerVersions(
  token: string,
  accountId: string,
  workerName: string,
): Promise<Array<{ id: string; number: number }>> {
  const slug = encodeURIComponent(workerName);
  const res = await fetch(
    `${CF_API}/accounts/${accountId}/workers/scripts/${slug}/versions`,
    { headers: cfHeaders(token), signal: AbortSignal.timeout(30_000) },
  );
  if (!res.ok) return [];
  const data = await res
    .json<{ result?: Array<{ id: string; number: number }> }>()
    .catch(() => ({}));
  return (data as any).result ?? [];
}

export async function deprovisionR2Bucket(
  token: string,
  accountId: string,
  bucketName: string,
): Promise<void> {
  const res = await fetch(
    `${CF_API}/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucketName)}`,
    {
      method: "DELETE",
      headers: cfHeaders(token),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok && res.status !== 404) {
    const rawBody = await res.text().catch(() => "");
    const body = redactSecretsFromText(rawBody, [token]);
    console.error("[cloudflare] r2_delete_failed", {
      status: res.status,
      body: body.slice(0, 300),
    });
    throw new Error(
      `R2 bucket deletion failed (${res.status}). Check your Cloudflare API token has R2:Edit permission.`,
    );
  }
}

// ── DNS helpers ────────────────────────────────────────────────────────────────

export interface CfDnsResult {
  added: string[]; // record names that were created
  skipped: string[]; // already existed or zone not found
  failed: string[]; // non-409 failures, as "<name> (<status>)"
}

/** Find the Cloudflare zone ID for a given domain (apex lookup). */
export async function findZoneId(
  token: string,
  domain: string,
): Promise<string | null> {
  // Strip to apex: "sub.example.com" → "example.com"
  const parts = domain.split(".");
  const apex = parts.length >= 2 ? parts.slice(-2).join(".") : domain;
  const res = await fetch(
    `${CF_API}/zones?name=${encodeURIComponent(apex)}&per_page=1`,
    { headers: cfHeaders(token), signal: AbortSignal.timeout(30_000) },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { result?: Array<{ id: string }> };
  return data.result?.[0]?.id ?? null;
}

/**
 * Auto-add DNS records for a Vercel domain in Cloudflare.
 * - CNAME sub.example.com → cname.vercel-dns.com (proxied)
 * - A example.com → 76.76.21.21 for apex (proxied)
 * - TXT records from Vercel's verification array
 * Skips silently if record already exists (409).
 */
export async function addVercelDnsRecords(
  token: string,
  domainName: string,
  cname: string | undefined,
  verification: Array<{ type: string; domain: string; value: string }>,
): Promise<CfDnsResult> {
  const zoneId = await findZoneId(token, domainName);
  if (!zoneId) return { added: [], skipped: [domainName], failed: [] };

  const parts = domainName.split(".");
  const isApex = parts.length === 2;

  const records: Array<{
    type: string;
    name: string;
    content: string;
    proxied?: boolean;
  }> = [];

  if (isApex) {
    // Apex domain → A record pointing to Vercel's anycast IP
    records.push({
      type: "A",
      name: domainName,
      content: "76.76.21.21",
      proxied: true,
    });
  } else if (cname) {
    records.push({
      type: "CNAME",
      name: domainName,
      content: cname,
      proxied: true,
    });
  }

  // TXT verification records
  for (const v of verification) {
    if (v.type === "TXT") {
      records.push({ type: "TXT", name: v.domain, content: v.value });
    }
  }

  const added: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  for (const record of records) {
    const res = await fetch(`${CF_API}/zones/${zoneId}/dns_records`, {
      method: "POST",
      headers: cfHeaders(token),
      body: JSON.stringify(record),
      signal: AbortSignal.timeout(30_000),
    });
    assertNotRateLimited(res);
    if (res.ok) {
      added.push(record.name);
    } else if (res.status === 409) {
      // Record already exists
      skipped.push(record.name);
    } else {
      failed.push(`${record.name} (${res.status})`);
    }
  }

  return { added, skipped, failed };
}

export type CfWorkerErrors =
  | { status: "ok"; errorCount: number; requestCount: number }
  | { status: "unauthorized" }
  | { status: "error" };

/** Pure: turn a Cloudflare GraphQL analytics response into a CfWorkerErrors. */
export function parseWorkerErrorsResponse(json: unknown): CfWorkerErrors {
  const j = json as
    | {
        data?: {
          viewer?: {
            accounts?: Array<{
              workersInvocationsAdaptiveGroups?: Array<{
                sum?: { errors?: number; requests?: number };
              }>;
            }>;
          };
        };
        errors?: Array<{ message?: string }>;
      }
    | null
    | undefined;

  if (j && Array.isArray(j.errors) && j.errors.length > 0) {
    const blob = j.errors
      .map((e) => e?.message ?? "")
      .join(" ")
      .toLowerCase();
    if (
      blob.includes("authentication") ||
      blob.includes("permission") ||
      blob.includes("not authorized") ||
      blob.includes("unauthorized") ||
      blob.includes("forbidden")
    ) {
      return { status: "unauthorized" };
    }
    return { status: "error" };
  }

  const accounts = j?.data?.viewer?.accounts;
  if (!Array.isArray(accounts)) return { status: "error" };

  let errorCount = 0;
  let requestCount = 0;
  for (const acct of accounts) {
    const groups = acct?.workersInvocationsAdaptiveGroups ?? [];
    for (const g of groups) {
      errorCount += g?.sum?.errors ?? 0;
      requestCount += g?.sum?.requests ?? 0;
    }
  }
  return { status: "ok", errorCount, requestCount };
}

/**
 * Query Cloudflare GraphQL Analytics for a worker's error + request counts since
 * `sinceMs`. Never throws — auth/permission failures return "unauthorized" (so the
 * caller can surface the missing Account Analytics:Read scope), other failures
 * return "error".
 */
export async function getCloudflareWorkerErrors(
  token: string,
  accountId: string,
  scriptName: string,
  sinceMs: number,
): Promise<CfWorkerErrors> {
  const query = `
    query WorkerErrors($accountTag: String!, $scriptName: String!, $since: Time!, $until: Time!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptiveGroups(
            limit: 100
            filter: { scriptName: $scriptName, datetime_geq: $since, datetime_leq: $until }
          ) {
            sum { errors requests }
          }
        }
      }
    }`;
  const variables = {
    accountTag: accountId,
    scriptName,
    since: new Date(sinceMs).toISOString(),
    until: new Date().toISOString(),
  };

  try {
    const res = await fetch(`${CF_API}/graphql`, {
      method: "POST",
      headers: { ...cfHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401 || res.status === 403) return { status: "unauthorized" };
    if (!res.ok) return { status: "error" };
    const json = await res.json().catch(() => null);
    return parseWorkerErrorsResponse(json);
  } catch {
    return { status: "error" };
  }
}

/** Delete all Vercel-related DNS records for a domain from Cloudflare.
 *  Removes the A/CNAME routing record and any _vercel TXT verification records. */
export async function deleteVercelDnsRecords(
  token: string,
  domainName: string,
): Promise<{ deleted: string[] }> {
  const zoneId = await findZoneId(token, domainName);
  if (!zoneId) return { deleted: [] };

  // List all records whose name matches the domain or its _vercel prefix
  const namesToDelete = [domainName, `_vercel.${domainName}`];
  const deleted: string[] = [];

  for (const name of namesToDelete) {
    const listRes = await fetch(
      `${CF_API}/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}&per_page=100`,
      { headers: cfHeaders(token), signal: AbortSignal.timeout(30_000) },
    );
    if (!listRes.ok) continue;
    const data = (await listRes.json()) as { result?: Array<{ id: string; name: string }> };
    for (const record of data.result ?? []) {
      const delRes = await fetch(`${CF_API}/zones/${zoneId}/dns_records/${record.id}`, {
        method: "DELETE",
        headers: cfHeaders(token),
        signal: AbortSignal.timeout(30_000),
      });
      if (delRes.ok) deleted.push(record.name);
    }
  }

  return { deleted };
}

export type CfWorkerMetrics =
  | { status: "ok"; requests: number; cpuMs: number }
  | { status: "unauthorized" }
  | { status: "error" };

/**
 * Fetch total requests and total CPU ms for a worker script on a given calendar day.
 * `dateStr` format: "YYYY-MM-DD" (UTC).
 * Never throws — returns `{ status: "error" }` on any failure.
 */
export async function getCloudflareWorkerMetrics(
  token: string,
  accountId: string,
  scriptName: string,
  dateStr: string,
): Promise<CfWorkerMetrics> {
  const since = `${dateStr}T00:00:00Z`;
  const until = `${dateStr}T23:59:59Z`;

  const query = `
    query WorkerMetrics($accountTag: String!, $scriptName: String!, $since: Time!, $until: Time!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptiveGroups(
            limit: 1
            filter: { scriptName: $scriptName, datetime_geq: $since, datetime_leq: $until }
          ) {
            sum { requests cpuTime }
          }
        }
      }
    }`;
  const variables = { accountTag: accountId, scriptName, since, until };

  try {
    const res = await fetch(`${CF_API}/graphql`, {
      method: "POST",
      headers: { ...cfHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401 || res.status === 403) return { status: "unauthorized" };
    if (!res.ok) return { status: "error" };
    const json = await res.json().catch(() => null);
    const groups =
      (json as any)?.data?.viewer?.accounts?.[0]
        ?.workersInvocationsAdaptiveGroups ?? [];
    const requests = groups.reduce(
      (s: number, g: any) => s + (g?.sum?.requests ?? 0),
      0,
    );
    const cpuMs = groups.reduce(
      (s: number, g: any) => s + (g?.sum?.cpuTime ?? 0),
      0,
    );
    return { status: "ok", requests, cpuMs };
  } catch {
    return { status: "error" };
  }
}

export interface CfObsResult {
  status: "ok";
  requests24h: number;
  errorRate: number;
  cpuP50Ms: number;
  cpuP99Ms: number;
}

export async function getCloudflareObservability(
  token: string,
  accountId: string,
  scriptName: string,
): Promise<CfObsResult | { status: "error" | "unauthorized" }> {
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const until = now.toISOString();

  const query = `
    query ObsMetrics($accountTag: String!, $scriptName: String!, $since: Time!, $until: Time!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptiveGroups(
            limit: 10000
            filter: { scriptName: $scriptName, datetime_geq: $since, datetime_leq: $until }
          ) {
            sum { requests errors }
            quantiles { cpuTimeP50 cpuTimeP99 }
          }
        }
      }
    }`;

  try {
    const res = await fetch(`${CF_API}/graphql`, {
      method: "POST",
      headers: { ...cfHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { accountTag: accountId, scriptName, since, until } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401 || res.status === 403) return { status: "unauthorized" };
    if (!res.ok) return { status: "error" };
    const json = await res.json().catch(() => null);
    const groups: Array<{ sum: { requests: number; errors: number }; quantiles: { cpuTimeP50: number; cpuTimeP99: number } }> =
      (json as any)?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptiveGroups ?? [];

    const requests = groups.reduce((s, g) => s + (g.sum?.requests ?? 0), 0);
    const errors = groups.reduce((s, g) => s + (g.sum?.errors ?? 0), 0);
    // CF returns CPU time in microseconds; convert to ms
    const cpuP50Us = groups[0]?.quantiles?.cpuTimeP50 ?? 0;
    const cpuP99Us = groups[0]?.quantiles?.cpuTimeP99 ?? 0;

    return {
      status: "ok",
      requests24h: requests,
      errorRate: requests === 0 ? 0 : errors / requests,
      cpuP50Ms: Math.round(cpuP50Us / 1000),
      cpuP99Ms: Math.round(cpuP99Us / 1000),
    };
  } catch {
    return { status: "error" };
  }
}
