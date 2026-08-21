import { redactSecretsFromText, getUserToken } from "../utils";
import { scopedQuery } from "../tenancy";
import { createLogger } from "../logger";
import {
  buildMutationDDL,
  liveTypeToEditorType,
  qi,
  RESERVED_COLS,
  type SchemaMutation,
  type ColumnDef,
  type TableDef,
} from "../schema/supabaseSchema";
import {
  EXTENSION_WHITELIST,
  EXTENSION_DESCRIPTIONS,
  type ExtensionInfo,
} from "../schema/extensions";
import { commitCanvasTables } from "../canvasTables";

const SB_MGMT = "https://api.supabase.com";
const log = createLogger({ connector: "supabase" });

function sbHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export function generatePassword(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  return Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((b) => chars[b % chars.length])
    .join("");
}

export interface SupabaseOutput {
  supabase_project_ref: string;
  supabase_url: string;
  supabase_anon_key: string;
  supabase_service_role: string;
  // Named env-var aliases for downstream injection
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  // CF Workers / generic backend aliases
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

export async function provisionSupabase(
  token: string,
  projectName: string,
  params: { region?: string } = {},
  cancelSignal?: AbortSignal,
): Promise<SupabaseOutput> {
  // ── 1. Get org ID ────────────────────────────────────────────
  const orgsRes = await fetch(`${SB_MGMT}/v1/organizations`, {
    headers: sbHeaders(token),
    signal: cancelSignal ?? AbortSignal.timeout(30_000),
  });
  if (!orgsRes.ok) {
    const body = await orgsRes.text();
    throw new Error(
      `Failed to fetch Supabase organizations (${orgsRes.status}): ${body.slice(0, 200)}`,
    );
  }
  const orgs = await orgsRes.json<Array<{ id: string; name: string }>>();
  if (!orgs.length) throw new Error("No Supabase organization found");
  const orgId = orgs[0].id;

  // ── 2. Create project (idempotent: reuse if same name exists) ───
  // Preserve the tail (unique project-ID suffix) when truncating to 30 chars.
  // Callers pass "basename-<6-char-id>"; slice(0, 30) from the front would silently
  // drop the suffix if the basename is long, making two long-named projects collide.
  const raw = projectName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const name =
    raw.length <= 30
      ? raw
      : `${raw.slice(0, 23)}-${raw.slice(-6)}`.replace(/-+/g, "-").slice(0, 30);

  // Check for an existing project with the same name — handles retries after partial failure
  let ref: string | undefined;
  const listRes = await fetch(`${SB_MGMT}/v1/projects`, {
    headers: sbHeaders(token),
    signal: cancelSignal ?? AbortSignal.timeout(30_000),
  });
  if (listRes.ok) {
    const all =
      await listRes.json<
        Array<{ ref: string; name: string; status: string }>
      >();
    const match = all.find((p) => p.name === name);
    if (match) ref = match.ref;
  }

  if (cancelSignal?.aborted) throw new Error("cancelled");

  if (!ref) {
    const dbPass = generatePassword();
    const createRes = await fetch(`${SB_MGMT}/v1/projects`, {
      method: "POST",
      headers: sbHeaders(token),
      body: JSON.stringify({
        name,
        organization_id: orgId,
        plan: "free",
        region: params.region || "us-east-1",
        db_pass: dbPass,
      }),
      signal: cancelSignal ?? AbortSignal.timeout(30_000),
    });
    if (!createRes.ok) {
      const body = redactSecretsFromText(await createRes.text(), [dbPass]);
      let msg = `${createRes.status}: ${body.slice(0, 200)}`;
      try {
        msg = (JSON.parse(body) as any).message ?? msg;
      } catch {
        /* not JSON */
      }

      if (
        createRes.status === 403 ||
        msg.toLowerCase().includes("limit") ||
        msg.toLowerCase().includes("upgrade") ||
        msg.toLowerCase().includes("quota")
      ) {
        throw new Error(
          "Your Supabase free plan allows up to 2 active projects. Please delete an existing project at supabase.com/dashboard and try again, or upgrade your plan.",
        );
      }

      throw new Error(`Supabase project creation failed: ${msg}`);
    }
    const project = await createRes.json<{ id: string; ref: string }>();
    ref = project.ref;
  }

  // ── 3. Poll until active (max ~6 min) ────────────────────────
  // 15s interval keeps the same ~6min ceiling at 1/3 the subrequest cost of
  // the previous 5s interval (24 vs 72 worst-case fetches) — Supabase project
  // activation doesn't change state faster than every few seconds anyway, so
  // this costs no real wall-clock wait time on the common path.
  let ready = false;
  for (let i = 0; i < 24; i++) {
    // Abort the interruptible sleep when the caller cancels
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 15_000);
      cancelSignal?.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(new Error("cancelled"));
        },
        { once: true },
      );
    });
    if (cancelSignal?.aborted) throw new Error("cancelled");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const statusRes = await fetch(`${SB_MGMT}/v1/projects/${ref}`, {
        headers: sbHeaders(token),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (statusRes.ok) {
        const p = await statusRes.json<{ status: string }>();
        if (p.status === "ACTIVE_HEALTHY") {
          ready = true;
          break;
        }
      }
    } catch (e) {
      clearTimeout(timer);
      if ((e as Error).message === "cancelled") throw e;
      // request timed out or network error — continue polling
    }
  }
  if (!ready) throw new Error("Supabase project did not become ready in time");

  // ── 4. Get API keys ──────────────────────────────────────────
  const keysRes = await fetch(`${SB_MGMT}/v1/projects/${ref}/api-keys`, {
    headers: sbHeaders(token),
    signal: cancelSignal ?? AbortSignal.timeout(30_000),
  });
  if (!keysRes.ok) throw new Error("Failed to fetch Supabase API keys");
  const keys = await keysRes.json<Array<{ name: string; api_key: string }>>();

  const anon = keys.find((k) => k.name === "anon")?.api_key ?? "";
  const serviceRole =
    keys.find((k) => k.name === "service_role")?.api_key ?? "";
  const url = `https://${ref}.supabase.co`;

  return {
    supabase_project_ref: ref,
    supabase_url: url,
    supabase_anon_key: anon,
    supabase_service_role: serviceRole,
    // Named aliases that downstream services read from ctx
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: serviceRole,
    // Generic backend aliases (CF Workers, Node.js, etc.)
    SUPABASE_URL: url,
    SUPABASE_ANON_KEY: anon,
  };
}

export interface AuthConfig {
  siteUrl?: string; // e.g. https://my-app.vercel.app
  smtpHost?: string; // smtp.resend.com
  smtpPass?: string; // Resend API key
  smtpSenderEmail?: string;
  smtpSenderName?: string;
}

/**
 * Configure Supabase Auth settings for a provisioned project.
 * Called after all services are provisioned so Vercel URL + Resend key are known.
 * Enables:
 *   - Email/password auth
 *   - Magic link / OTP
 *   - Correct redirect URLs (site URL + wildcard)
 *   - Resend SMTP for email delivery
 *   - Supabase Auth OAuth server (project as OIDC provider)
 */
export async function configureSupabaseAuth(
  token: string,
  ref: string,
  cfg: AuthConfig,
): Promise<void> {
  const body: Record<string, unknown> = {
    // Enable core email auth
    external_email_enabled: true,
    mailer_secure_email_change_enabled: true,
    mailer_autoconfirm: false,

    // Enable OAuth server (Supabase project as OAuth 2.1 / OIDC provider)
    // https://supabase.com/docs/guides/auth/oauth-server
    external_anonymous_users_enabled: false,
  };

  if (cfg.siteUrl) {
    body.site_url = cfg.siteUrl;
    body.uri_allow_list = `${cfg.siteUrl},${cfg.siteUrl}/**`;
  }

  if (cfg.smtpHost && cfg.smtpPass && cfg.smtpSenderEmail) {
    body.smtp_admin_email = cfg.smtpSenderEmail;
    body.smtp_host = cfg.smtpHost;
    body.smtp_port = "465";
    body.smtp_user = "resend";
    body.smtp_pass = cfg.smtpPass;
    body.smtp_sender_name = cfg.smtpSenderName ?? "My App";
    body.smtp_max_frequency = 5;
  }

  const res = await fetch(`${SB_MGMT}/v1/projects/${ref}/config/auth`, {
    method: "PATCH",
    headers: sbHeaders(token),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const err = await res.json<{ message?: string }>().catch(() => ({}));
    const rawMsg = (err as any).message ?? String(res.status);
    // cfg.siteUrl is intentionally excluded — it's the app's own public URL,
    // not a secret, and redacting it would just hide useful debug info.
    const msg = redactSecretsFromText(rawMsg, [cfg.smtpPass, token]);
    throw new Error(`Supabase auth config failed: ${msg}`);
  }
}

export async function deprovisionSupabase(
  token: string,
  params: { supabase_project_ref: string },
): Promise<void> {
  const res = await fetch(
    `${SB_MGMT}/v1/projects/${params.supabase_project_ref}`,
    {
      method: "DELETE",
      headers: sbHeaders(token),
    },
  );
  if (!res.ok && res.status !== 404 && res.status !== 400) {
    const err = await res.json<{ message?: string }>().catch(() => ({}));
    const rawMsg = (err as any).message ?? String(res.status);
    const msg = redactSecretsFromText(rawMsg, [token]);
    throw new Error(`Supabase project delete failed: ${msg}`);
  }
}

export async function applySupabaseSchema(
  token: string,
  ref: string,
  tables: import("../schema/supabaseSchema").TableDef[],
  cancelSignal?: AbortSignal,
): Promise<void> {
  if (!tables.length) return;

  if (!/^[a-z0-9-]+$/.test(ref))
    throw new Error(`Invalid Supabase project ref: "${ref}"`);

  const { buildDDL } = await import("../schema/supabaseSchema");
  const sql = buildDDL(tables);

  const res = await fetch(`${SB_MGMT}/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: sbHeaders(token),
    body: JSON.stringify({ query: sql }),
    signal: cancelSignal ?? AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const err = await res
      .json<{ message?: string; error?: string }>()
      .catch(() => ({}));
    const rawMsg =
      (err as any).message ?? (err as any).error ?? String(res.status);
    const msg = redactSecretsFromText(rawMsg, [token]);
    throw new Error(`Supabase schema apply failed: ${msg}`);
  }
}

export interface CloneSupabaseOutput extends SupabaseOutput {
  /** True when a fresh clone project was created (vs an idempotent reuse). */
  cloned: boolean;
}

/**
 * Create an ISOLATED Supabase clone for a branch environment.
 *
 * Native Supabase Branching is deliberately NOT used: it is
 * migration-file driven, whereas Leenar applies schema imperatively, so a
 * native branch DB would come up empty. Instead we provision a brand-new
 * project and clone the source's LIVE schema via introspection
 * (`introspectSchema` -> `buildCreateDDLFromLiveSchema`) — this mirrors
 * whatever actually exists in the live DB (including anything added outside
 * the canvas seed, e.g. via the SQL runner or typed mutations), not just the
 * canvas node's authored `tables`. `tables` is now used only for the
 * back-compat fallback below.
 *
 * Known limitations (see `buildCreateDDLFromLiveSchema`'s doc comment for
 * detail): foreign keys are not replayed (introspection doesn't capture the
 * referenced table/column), and RLS *policies* are not replayed — only the
 * table-level RLS-enabled flag is cloned.
 *
 * `sourceRef` is used both for the live-schema clone AND (optionally) for
 * data seeding: when `seedData` is true we best-effort copy each table's
 * rows from the source into the clone (bounded — see SEED_ROW_CAP).
 */
export async function cloneSupabase(
  token: string,
  params: {
    projectName: string;
    region?: string;
    tables?: import("../schema/supabaseSchema").TableDef[];
    sourceRef?: string;
    seedData?: boolean;
  },
  cancelSignal?: AbortSignal,
): Promise<CloneSupabaseOutput> {
  const tables = params.tables ?? [];

  // 1. Provision the isolated clone project (idempotent by name).
  const out = await provisionSupabase(
    token,
    params.projectName,
    { region: params.region },
    cancelSignal,
  );

  // 2. Clone the LIVE schema via introspection. Let introspectSchema's
  // errors propagate uncaught — the outer provisioner deprovisions the
  // clone on error, matching existing clone-failure behavior; falling back
  // to a schemaless clone here would silently hide the failure.
  let liveSchema: LiveSchema | undefined;
  if (params.sourceRef) {
    liveSchema = await introspectSchema(token, params.sourceRef);
    const ddl = buildCreateDDLFromLiveSchema(liveSchema);
    if (ddl.trim())
      await executeSql(token, out.supabase_project_ref, ddl, "write");
  } else if (tables.length) {
    // Back-compat fallback: no source to introspect (shouldn't happen for a
    // branch clone in practice) — fall back to the authored canvas seed.
    await applySupabaseSchema(token, out.supabase_project_ref, tables);
  }

  // 3. Optional bounded data seeding from the source project, driven off
  // the LIVE table list (not the possibly-stale authored `tables`).
  if (params.seedData && params.sourceRef && liveSchema?.tables.length) {
    await seedSupabaseData(
      token,
      params.sourceRef,
      out.supabase_project_ref,
      liveSchema.tables.map((t) => ({ name: t.name, columns: [] })),
    );
  }

  return { ...out, cloned: true };
}

/** Max rows copied per table during seeding. Copying is done through the
 *  management query API (JSON round-trip), so we bound payload size and LOG
 *  when a table is truncated rather than silently dropping rows. */
const SEED_ROW_CAP = 1000;

async function seedSupabaseData(
  token: string,
  sourceRef: string,
  targetRef: string,
  tables: import("../schema/supabaseSchema").TableDef[],
): Promise<void> {
  for (const ref of [sourceRef, targetRef])
    if (!/^[a-z0-9-]+$/.test(ref))
      throw new Error(`Invalid Supabase project ref: "${ref}"`);

  const runQuery = async (ref: string, query: string): Promise<unknown[]> => {
    const res = await fetch(`${SB_MGMT}/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: sbHeaders(token),
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const err = await res
        .json<{ message?: string; error?: string }>()
        .catch(() => ({}));
      const rawMsg =
        (err as any).message ?? (err as any).error ?? String(res.status);
      throw new Error(
        `Supabase seed query failed: ${redactSecretsFromText(rawMsg, [token])}`,
      );
    }
    return (await res.json().catch(() => [])) as unknown[];
  };

  for (const table of tables) {
    // Table name comes from Leenar's own authored schema (validated at author
    // time), not user free-text — but quote defensively for the identifier.
    const name = table.name;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) continue;

    const rows = (await runQuery(
      sourceRef,
      `select to_jsonb(t) as row from public."${name}" t limit ${SEED_ROW_CAP + 1}`,
    )) as Array<{ row: Record<string, unknown> }>;

    if (rows.length > SEED_ROW_CAP) {
      log.warn("supabase.seed_truncated", {
        table: name,
        cap: SEED_ROW_CAP,
      });
      rows.length = SEED_ROW_CAP;
    }
    if (!rows.length) continue;

    // Bulk insert via jsonb_populate_recordset so we don't hand-serialize each
    // column. ON CONFLICT DO NOTHING keeps seeding idempotent across retries.
    const payload = JSON.stringify(rows.map((r) => r.row)).replace(/'/g, "''");
    await runQuery(
      targetRef,
      `insert into public."${name}" select * from jsonb_populate_recordset(null::public."${name}", '${payload}'::jsonb) on conflict do nothing`,
    );
  }
}

export interface SupabaseUsage {
  db_size?: number;
  mau?: number;
}

export async function getSupabaseUsage(
  token: string,
  ref: string,
): Promise<SupabaseUsage | null> {
  const res = await fetch(`${SB_MGMT}/v1/projects/${ref}/usage`, {
    headers: sbHeaders(token),
  });
  if (!res.ok) return null;
  const data = await res
    .json<{ data?: Array<{ attribute: string; usage: number }> }>()
    .catch(() => ({}));
  const result: SupabaseUsage = {};
  for (const m of (data as any).data ?? []) {
    if (m.attribute === "db_size") result.db_size = m.usage;
    if (m.attribute === "monthly_active_users") result.mau = m.usage;
  }
  return Object.keys(result).length ? result : null;
}

export const MAX_ROWS = 1000;

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
}

// Sends a SQL string to the Management query endpoint. Returns row objects.
export async function runQuery(
  token: string,
  ref: string,
  sql: string,
): Promise<Record<string, unknown>[]> {
  if (!/^[a-z0-9-]+$/.test(ref))
    throw new Error(`Invalid Supabase project ref: "${ref}"`);
  const res = await fetch(`${SB_MGMT}/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: sbHeaders(token),
    body: JSON.stringify({ query: sql }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const err = await res
      .json<{ message?: string; error?: string }>()
      .catch(() => ({}));
    const rawMsg =
      (err as any).message ?? (err as any).error ?? String(res.status);
    throw new Error(redactSecretsFromText(rawMsg, [token]));
  }
  const data = await res.json<unknown>();
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

export interface LiveColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  default: string | null;
  isPrimaryKey: boolean;
  isUnique: boolean;
  isForeignKey: boolean;
}
export interface LiveIndex {
  name: string;
  definition: string;
}
export interface LivePolicy {
  name: string;
  command: string; // pg_policies.cmd: 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'
  roles: string[]; // pg_policies.roles (text[])
  using: string | null; // pg_policies.qual
  withCheck: string | null; // pg_policies.with_check
  permissive: boolean; // pg_policies.permissive === 'PERMISSIVE'
}
export interface LiveTable {
  name: string;
  columns: LiveColumn[];
  indexes: LiveIndex[];
  rlsEnabled: boolean;
  policies: LivePolicy[];
}
export interface LiveSchema {
  tables: LiveTable[];
}

/**
 * Parses a Postgres `text[]` value as returned by the Supabase Management
 * API's query endpoint, which may serialize it either as a real JSON array
 * or as a Postgres brace-string (e.g. `"{authenticated,anon}"`). Does not
 * handle quoted-element edge cases — role names are simple identifiers.
 */
export function parsePgTextArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.startsWith("{")) {
    const inner = v.slice(1, -1);
    if (inner === "") return [];
    return inner
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
  }
  return [];
}

/**
 * Reads the live Postgres catalog for a provisioned Supabase project's
 * `public` schema. Scoped to `public` only — no other schemas.
 *
 * Issues one `runQuery` per catalog view in a FIXED order (columns, primary
 * keys, uniques, foreign keys, indexes, RLS, policies) via `Promise.all`.
 * `Promise.all` evaluates its array argument eagerly and left-to-right, so
 * all seven fetches are dispatched — in this exact order — before the
 * function ever awaits; that ordering is what test mocks (which resolve
 * `fetch` calls by call order) rely on. Do not reorder these queries.
 */
export async function introspectSchema(
  token: string,
  ref: string,
): Promise<LiveSchema> {
  const q = (sql: string) => runQuery(token, ref, sql);

  const [cols, pks, uniqs, fks, idxs, rls, pols] = await Promise.all([
    q(`select table_name, column_name, data_type, is_nullable, column_default
       from information_schema.columns
       where table_schema='public' order by table_name, ordinal_position`),
    q(`select tc.table_name, kcu.column_name
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name
       where tc.table_schema='public' and tc.constraint_type='PRIMARY KEY'`),
    q(`select tc.table_name, kcu.column_name
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name
       where tc.table_schema='public' and tc.constraint_type='UNIQUE'`),
    q(`select tc.table_name, kcu.column_name
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name
       where tc.table_schema='public' and tc.constraint_type='FOREIGN KEY'`),
    q(`select tablename, indexname, indexdef from pg_indexes where schemaname='public'`),
    q(`select c.relname as table_name, c.relrowsecurity as rls_enabled
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relkind='r'`),
    q(`select tablename, policyname, cmd, roles, qual, with_check, permissive
       from pg_policies where schemaname='public'`),
  ]);

  const keyset = (rows: Record<string, unknown>[]) => {
    const m = new Set<string>();
    for (const r of rows) m.add(`${r.table_name}.${r.column_name}`);
    return m;
  };
  const pkSet = keyset(pks);
  const uqSet = keyset(uniqs);
  const fkSet = keyset(fks);
  const rlsMap = new Map<string, boolean>(
    (rls as Record<string, unknown>[]).map((r) => [
      String(r.table_name),
      Boolean(r.rls_enabled),
    ]),
  );

  const tables = new Map<string, LiveTable>();
  const table = (name: string) => {
    let t = tables.get(name);
    if (!t) {
      t = {
        name,
        columns: [],
        indexes: [],
        rlsEnabled: rlsMap.get(name) ?? false,
        policies: [],
      };
      tables.set(name, t);
    }
    return t;
  };

  for (const r of cols as Record<string, unknown>[]) {
    const name = String(r.table_name);
    const col = String(r.column_name);
    table(name).columns.push({
      name: col,
      dataType: String(r.data_type),
      nullable: r.is_nullable === "YES",
      default: r.column_default == null ? null : String(r.column_default),
      isPrimaryKey: pkSet.has(`${name}.${col}`),
      isUnique: uqSet.has(`${name}.${col}`),
      isForeignKey: fkSet.has(`${name}.${col}`),
    });
  }
  for (const r of idxs as Record<string, unknown>[]) {
    const t = tables.get(String(r.tablename));
    if (t) {
      t.indexes.push({
        name: String(r.indexname),
        definition: String(r.indexdef),
      });
    }
  }
  for (const r of pols as Record<string, unknown>[]) {
    const t = tables.get(String(r.tablename));
    if (t) {
      t.policies.push({
        name: String(r.policyname),
        command: String(r.cmd),
        roles: parsePgTextArray(r.roles),
        using: r.qual == null ? null : String(r.qual),
        withCheck: r.with_check == null ? null : String(r.with_check),
        permissive: String(r.permissive).toUpperCase() === "PERMISSIVE",
      });
    }
  }

  return { tables: [...tables.values()] };
}

/**
 * Reads which of the CLOSED extension whitelist (schema/extensions.ts) are
 * installed on a provisioned Supabase project, via
 * `pg_extension`. Separate from `introspectSchema` — extensions are fetched
 * on-demand by their own tab, on a different cadence than the Tables/SQL
 * schema view.
 *
 * Always returns EXACTLY the whitelist, each annotated with its live install
 * state — never arbitrary extensions found in `pg_extension` that aren't on
 * the whitelist. This keeps the response shape a closed set even if the live
 * database has other extensions installed (e.g. plpgsql, pg_stat_statements).
 */
export async function introspectExtensions(
  token: string,
  ref: string,
): Promise<ExtensionInfo[]> {
  const rows = await runQuery(
    token,
    ref,
    "select extname, extversion from pg_extension",
  );
  const installedVersions = new Map<string, string>();
  for (const r of rows) {
    installedVersions.set(String(r.extname), String(r.extversion));
  }

  return EXTENSION_WHITELIST.map((name) => {
    const version = installedVersions.get(name) ?? null;
    return {
      name,
      installed: installedVersions.has(name),
      installedVersion: version,
      description: EXTENSION_DESCRIPTIONS[name],
    };
  });
}

// Defense-in-depth guard for catalog-sourced strings (dataType, default,
// index definition) that are replayed verbatim into DDL below. These values
// come from Postgres's own catalog (information_schema / pg_indexes), not
// user free-text, so this is a belt-and-braces check against a pathological
// catalog value rather than an injection boundary for arbitrary input.
//
// Rejects only statement terminators (`;`) and raw line breaks (`\n` / `\r`):
// splicing a second statement in requires one of those, and all identifiers
// still go through `qi`. We deliberately do NOT reject `--`: it only starts a
// SQL comment OUTSIDE a quoted string, whereas legitimate catalog values embed
// it inside string literals as ordinary data (e.g. a default `'000--000'::text`,
// or a partial-index predicate `WHERE note <> '--marker--'` in pg_get_indexdef
// output). Rejecting `--` outright would false-positive and fail the whole clone
// on any source table containing a double-hyphen inside a string literal.
function assertSafeCatalogFragment(label: string, val: string): void {
  if (val.includes(";") || val.includes("\n") || val.includes("\r"))
    throw new Error(`Unsafe ${label} from catalog: ${JSON.stringify(val)}`);
}

/**
 * Builds CREATE TABLE (+ RLS + index) DDL DIRECTLY from a `LiveSchema`
 * (introspected real Postgres catalog), NOT via `TableDef` -> `buildDDL`.
 * The `TableDef` round-trip is lossy (editor-enum types only) and would drop
 * anything outside Leenar's authored type vocabulary — e.g. a raw-SQL `inet`
 * column. This builder preserves every live column/type/default/index
 * verbatim so a branch clone faithfully mirrors the source's actual schema.
 *
 * Known limitations (documented here, not implemented):
 *  - Foreign keys are NOT replayed: `LiveColumn.isForeignKey` is a bare bool
 *    with no referenced table/column, so FK constraints can't be faithfully
 *    rebuilt from introspection alone — that needs a richer introspection
 *    query than this one issues.
 *  - RLS *policies* are NOT replayed, only the table-level RLS-enabled flag.
 *    Cloning `ENABLE ROW LEVEL SECURITY` without policies yields deny-all on
 *    the clone, which matches the source's table-level state (policies
 *    themselves are outside what introspectSchema reads).
 *  - Sequence-backed defaults (`nextval(...)`) are skipped: the sequence
 *    they reference won't exist in the fresh clone, so replaying them would
 *    break the CREATE TABLE. Everything else (gen_random_uuid(), now(),
 *    literals, casts) is replayed as-is.
 */
export function buildCreateDDLFromLiveSchema(schema: LiveSchema): string {
  const stmts: string[] = [];

  for (const t of schema.tables) {
    const tq = `public.${qi(t.name)}`;
    const colLines: string[] = [];
    const pkCols: string[] = [];

    for (const c of t.columns) {
      assertSafeCatalogFragment(`dataType (table "${t.name}", column "${c.name}")`, c.dataType);
      if (c.default != null)
        assertSafeCatalogFragment(`default (table "${t.name}", column "${c.name}")`, c.default);

      let line = `${qi(c.name)} ${c.dataType}`;
      if (!c.nullable) line += " NOT NULL";
      // Sequence-backed defaults reference a sequence that won't exist in
      // the fresh clone — skip them rather than break the CREATE TABLE.
      if (c.default != null && !c.default.startsWith("nextval("))
        line += ` DEFAULT ${c.default}`;
      colLines.push(line);

      if (c.isPrimaryKey) pkCols.push(c.name);
    }

    if (pkCols.length)
      colLines.push(`PRIMARY KEY (${pkCols.map((n) => qi(n)).join(", ")})`);

    stmts.push(`CREATE TABLE IF NOT EXISTS ${tq} (\n  ${colLines.join(",\n  ")}\n);`);

    if (t.rlsEnabled) stmts.push(`ALTER TABLE ${tq} ENABLE ROW LEVEL SECURITY;`);

    for (const ix of t.indexes) {
      if (ix.name.endsWith("_pkey")) continue; // PRIMARY KEY clause already creates this
      assertSafeCatalogFragment(`index definition (table "${t.name}", index "${ix.name}")`, ix.definition);
      stmts.push(`${ix.definition};`);
    }
  }

  return stmts.join("\n");
}

/**
 * Splits a SQL string on its TOP-LEVEL semicolons, lexing Postgres string
 * literals, dollar-quoted bodies, quoted identifiers and (nestable) comments so
 * a `;` inside any of them is never mistaken for a statement separator.
 * Comments collapse to a space; literal bodies collapse to an empty literal.
 *
 * A single-pass lexer rather than a sequence of regex strips, because either
 * strip order is defeatable. Strip comments first and `SELECT '--' ; DROP …`
 * loses its real `;` into a phantom comment; strip literals first and
 * `SELECT 1 --'\n; DROP … --'` has its real `;` swallowed by a phantom literal.
 * Both collapse to a lone innocent-looking SELECT.
 *
 * Backslash is treated as an ORDINARY character inside `'...'`, matching
 * `standard_conforming_strings=on` (Supabase's default — same premise
 * `sqlLiteral.ts` is built on). That deliberately mis-lexes a backslash-escaped
 * quote in an `E'...'` string, but only ever by ENDING a literal early, which
 * exposes more top-level `;` and so can only over-count statements. Erring
 * toward over-counting is the safe direction: it rejects an exotic-but-valid
 * query rather than admitting a smuggled one.
 */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];

    // -- line comment
    if (c === "-" && next === "-") {
      i += 2;
      while (i < n && sql[i] !== "\n") i++;
      buf += " ";
      continue;
    }

    // /* block comment */ — Postgres nests these, so track depth
    if (c === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      buf += " ";
      continue;
    }

    // $tag$ … $tag$ dollar-quoted body (tag may be empty: $$ … $$).
    // Only when the `$` does not continue an identifier: Postgres allows `$`
    // inside an identifier after the first character and lexes greedily, so the
    // `$` in `a$b$…` belongs to `a$b` and opens nothing. Skipping those keeps a
    // `;` after them visible — the over-counting, i.e. safe, direction.
    if (c === "$" && !/[A-Za-z0-9_$]/.test(sql[i - 1] ?? "")) {
      const m = /^\$([A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF]*)?\$/.exec(
        sql.slice(i),
      );
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        buf += "''";
        i = end === -1 ? n : end + tag.length; // unterminated → consume to end
        continue;
      }
    }

    // '…' string literal, '' being the only escape (see backslash note above)
    if (c === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      buf += "''";
      continue;
    }

    // "…" quoted identifier, "" escape
    if (c === '"') {
      i++;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      buf += '""';
      continue;
    }

    if (c === ";") {
      out.push(buf);
      buf = "";
      i++;
      continue;
    }

    buf += c;
    i++;
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

// Leading keywords a read-mode statement may start with. EXPLAIN is included
// even though EXPLAIN ANALYZE genuinely executes its inner statement, and WITH
// is included even though a writing CTE (WITH x AS (DELETE … RETURNING *) …)
// genuinely writes: both are caught by the READ ONLY transaction, which is
// sound again now that assertReadOnlyStatement guarantees nothing can escape it.
const READ_ONLY_LEAD_RE = /^(select|with|explain|show|table|values)\b/i;

/**
 * Gate for read-mode SQL. The `BEGIN; SET TRANSACTION READ ONLY; … ; ROLLBACK;`
 * wrapper below is string concatenation, and `SET TRANSACTION READ ONLY` binds
 * to the CURRENT transaction only — so caller SQL beginning with `ROLLBACK;`
 * ends that transaction and everything after it runs in autocommit, read-write.
 * Rejecting multi-statement input is what makes the wrapper a real boundary
 * instead of a suggestion; the leading-keyword check is the second layer.
 */
export function assertReadOnlyStatement(sql: string): void {
  const statements = splitSqlStatements(sql);
  if (statements.length === 0) throw new Error("No SQL statement provided.");
  if (statements.length > 1) {
    throw new Error(
      "Read mode runs exactly one statement — remove the ';' and any statements after it, or use write mode.",
    );
  }
  // Leading parens are legal: `(SELECT 1) UNION (SELECT 2)`.
  const head = statements[0].replace(/^[(\s]+/, "");
  if (!READ_ONLY_LEAD_RE.test(head)) {
    throw new Error(
      "Read mode accepts only SELECT / WITH / EXPLAIN / SHOW / TABLE / VALUES statements.",
    );
  }
}

export async function executeSql(
  token: string,
  ref: string,
  sql: string,
  mode: "read" | "write",
): Promise<QueryResult> {
  // Primary control for read mode — the wrapper below is defense-in-depth.
  if (mode === "read") assertReadOnlyStatement(sql);
  const query =
    mode === "read"
      ? `BEGIN; SET TRANSACTION READ ONLY; ${sql}; ROLLBACK;`
      : sql;
  const rows = await runQuery(token, ref, query);
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const truncated = rows.length > MAX_ROWS;
  const capped = truncated ? rows.slice(0, MAX_ROWS) : rows;
  return {
    columns,
    rows: capped.map((r) => columns.map((c) => r[c])),
    rowCount: capped.length,
    truncated,
  };
}

/**
 * Applies a single typed `SchemaMutation`
 * against a live Supabase project. Builds the DDL via `buildMutationDDL`
 * (which throws on invalid identifiers / reserved columns / bad types —
 * that throw is left to propagate uncaught) and always executes in
 * "write" mode. No edge/destructive gating here — that lives at the
 * route/MCP layer, consistent with the `mode`-is-the-gate model.
 */
export async function applySchemaMutation(
  token: string,
  ref: string,
  m: SchemaMutation,
): Promise<QueryResult> {
  const ddl = buildMutationDDL(m);
  return executeSql(token, ref, ddl, "write");
}

export async function resolveSupabaseNode(
  env: import("../types").Env,
  userId: string,
  projectId: string,
  nodeId: string,
): Promise<{ ref: string | null; provisioned: boolean }> {
  const res = await scopedQuery(env, userId, "projects", {
    query: `id=eq.${projectId}&select=canvas&limit=1`,
  });
  if (!res.ok) throw new Error("Failed to fetch project");
  const rows = (await res.json()) as Array<{ canvas: { nodes: any[] } }>;
  if (!rows.length) throw new Error("Project not found");
  const node = (rows[0].canvas?.nodes ?? []).find((n) => n.id === nodeId);
  if (!node) throw new Error("Node not found");
  if (node.data?.provider !== "supabase")
    throw new Error("Node is not a Supabase node");
  const ref = (node.data?.supabaseProjectRef as string | undefined) ?? null;
  return { ref, provisioned: Boolean(ref) };
}

/**
 * Refreshes a provisioned Supabase node's canvas snapshot (`node.data.tables`)
 * from the live database schema. The live DB is the source of truth post-
 * provision; this keeps the canvas's display-only snapshot current
 * after every live schema mutation.
 *
 * Token acquisition mirrors routes/database.ts's GET /:projectId/:nodeId/schema
 * handler exactly: getUserToken(env, userId, "supabase") — the same
 * decrypt/connection-lookup helper used everywhere else in route/tool context
 * (NOT the Durable-Object-only `this.getUserToken`).
 *
 * Excludes RESERVED_COLS (id/created_at) from the mapped snapshot: buildDDL
 * throws on reserved column names, and the redeploy path feeds this
 * snapshot back through applySupabaseSchema -> buildDDL, so including them
 * would break redeploy.
 */
export async function refreshNodeSnapshot(
  env: import("../types").Env,
  userId: string,
  projectId: string,
  nodeId: string,
  prefetched?: LiveSchema,
): Promise<void> {
  const { ref, provisioned } = await resolveSupabaseNode(
    env,
    userId,
    projectId,
    nodeId,
  );
  if (!provisioned || !ref) return;

  let schema: LiveSchema;
  if (prefetched) {
    schema = prefetched;
  } else {
    const token = await getUserToken(env, userId, "supabase");
    schema = await introspectSchema(token, ref);
  }

  const tables: TableDef[] = schema.tables.map((t) => ({
    name: t.name,
    columns: t.columns
      .filter((c) => !RESERVED_COLS.has(c.name))
      .map((c) => {
        const col: ColumnDef = { name: c.name, type: liveTypeToEditorType(c.dataType) };
        if (c.nullable) col.nullable = true;
        if (c.isUnique) col.unique = true;
        if (c.default != null) col.default = c.default;
        return col;
      }),
  }));

  await commitCanvasTables(env, userId, projectId, nodeId, tables, {
    setSnapshotAt: new Date().toISOString(),
    clearAppliedColumns: true,
  });
}

/** Project refs the token's account owns. Returns `null` when the call
 *  fails, so a transient Supabase outage degrades to "unknown ownership"
 *  rather than wrongly claiming the user does not own their own project. */
export async function listProjectRefs(token: string): Promise<string[] | null> {
  const res = await fetch(`${SB_MGMT}/v1/projects`, {
    headers: sbHeaders(token),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const data = (await res.json().catch(() => [])) as Array<{ id?: string }>;
  return data.map((p) => p.id).filter((id): id is string => typeof id === "string");
}
