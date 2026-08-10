#!/usr/bin/env node
// Creates the first Leenar account from .env, so a self-host install has a way
// in that does not require a browser.
//
// Why this exists: everything in Leenar is per-user — RLS on `user_id`,
// `auth.users(id)` foreign keys on every table, per-user provider tokens
// decrypted by `getUserToken(userId, …)`. Supabase's own self-host solves the
// equivalent problem by putting DASHBOARD_USERNAME/PASSWORD in .env and
// wiring a Kong `basic-auth` plugin in front of Studio, and it never creates a
// user at all — Studio talks to Postgres as service_role. We cannot copy that:
// a gateway-level password would authenticate the BROWSER but leave
// `auth.uid()` null, and every query would then fail RLS. So the .env
// credentials have to become a real GoTrue user.
//
// Deliberately create-only. Editing LEENAR_ADMIN_PASSWORD after first boot
// does NOT reset the account — re-applying it on every `docker compose up`
// would silently undo a password the user changed in the app. SELF-HOST.md
// documents the psql reset one-liner instead.
//
// Runs on node:24-bookworm-slim (already pulled as the api/web build base) and
// uses global fetch, so the stack gains no new image and no dependency.

const MIN_PASSWORD_LENGTH = 8;

/**
 * Decide what to do from the environment alone, with no I/O — the whole
 * config-validation surface in one pure function.
 */
export function planBootstrap(env) {
  const email = (env.LEENAR_ADMIN_EMAIL || "").trim();
  const password = env.LEENAR_ADMIN_PASSWORD || "";

  if (!email && !password) {
    return {
      action: "skip",
      reason:
        "LEENAR_ADMIN_EMAIL / LEENAR_ADMIN_PASSWORD are empty — no account created. Sign up at http://localhost:8080/signup instead.",
    };
  }
  // One without the other is a half-finished edit, not a deliberate opt-out.
  // Say so rather than silently doing nothing.
  if (!email || !password) {
    return {
      action: "skip",
      warn: true,
      reason: `LEENAR_ADMIN_${email ? "PASSWORD" : "EMAIL"} is empty — both are required to create the first account. Skipping.`,
    };
  }
  if (!email.includes("@")) {
    return { action: "fail", reason: `LEENAR_ADMIN_EMAIL is not an email address: ${email}` };
  }
  // GoTrue would reject a short password with an opaque 422; fail with the
  // actual rule instead. 8 matches the signup form's own minLength.
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      action: "fail",
      reason: `LEENAR_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters (got ${password.length}).`,
    };
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return { action: "fail", reason: "SUPABASE_SERVICE_ROLE_KEY is not set." };
  }
  return {
    action: "create",
    email,
    password,
    baseUrl: (env.SUPABASE_URL || "http://kong:8000").replace(/\/+$/, ""),
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

/**
 * Block until GoTrue answers. `depends_on: kong healthy` only proves the
 * gateway is up — Kong starts happily while its auth upstream is still
 * booting, so the wait belongs here.
 */
export async function waitForAuth(
  { fetch, sleep, log },
  baseUrl,
  { attempts = 60, delayMs = 2000 } = {},
) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(`${baseUrl}/auth/v1/health`);
      if (res.ok) return true;
    } catch {
      // Connection refused while the upstream boots — expected, keep waiting.
    }
    if (i === attempts) return false;
    if (i === 1) log(`waiting for auth at ${baseUrl}/auth/v1/health …`);
    await sleep(delayMs);
  }
  return false;
}

/**
 * Idempotency comes from GoTrue's own uniqueness constraint rather than a
 * pre-flight lookup: a "already registered" rejection IS the success case on
 * every boot after the first.
 */
function isAlreadyRegistered(status, body) {
  if (status !== 422 && status !== 400) return false;
  return body?.error_code === "email_exists" || /already/i.test(body?.msg || body?.message || "");
}

export async function createAdmin({ fetch }, { baseUrl, serviceRoleKey, email, password }) {
  const res = await fetch(`${baseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({
      email,
      password,
      // The stack runs a noop mail client, so an unconfirmed account could
      // never be confirmed. Confirm it here — same posture as the compose
      // file's GOTRUE_MAILER_AUTOCONFIRM for browser signup.
      email_confirm: true,
      user_metadata: { name: email.split("@")[0] },
    }),
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON error page (e.g. a gateway 502) — status alone drives the branch.
  }
  if (res.ok) return { created: true };
  if (isAlreadyRegistered(res.status, body)) return { created: false, existed: true };
  return {
    created: false,
    error: `GoTrue returned ${res.status}: ${JSON.stringify(body) || "(no body)"}`,
  };
}

export async function run(io, env) {
  const { log, warn } = io;
  const plan = planBootstrap(env);

  if (plan.action === "skip") {
    (plan.warn ? warn : log)(plan.reason);
    return 0;
  }
  if (plan.action === "fail") {
    warn(plan.reason);
    return 1;
  }

  if (!(await waitForAuth(io, plan.baseUrl))) {
    warn(`auth never became reachable at ${plan.baseUrl} — no account created.`);
    return 1;
  }

  const result = await createAdmin(io, plan);
  if (result.existed) {
    log(`account ${plan.email} already exists — nothing to do.`);
    return 0;
  }
  if (result.error) {
    warn(`could not create ${plan.email}: ${result.error}`);
    return 1;
  }
  log(`created ${plan.email} — sign in at http://localhost:8080/login`);
  return 0;
}

// `node bootstrap-admin.mjs` runs it; `import` (the test) does not.
if (process.argv[1] && process.argv[1].endsWith("bootstrap-admin.mjs")) {
  const io = {
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (m) => console.log(`==> bootstrap: ${m}`),
    warn: (m) => console.error(`==> bootstrap: ${m}`),
  };
  process.exit(await run(io, process.env));
}
