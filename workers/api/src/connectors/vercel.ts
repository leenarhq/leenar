import { createLogger } from "../logger";
import { redactSecretsFromText } from "../utils";
import { assertNotRateLimited, RateLimitError } from "./errors";
import {
  resolveEnvKeys,
  PUBLIC_ENV_BASES,
  FRAMEWORK_PREFIX,
  ALL_CLIENT_PREFIXES,
  type Framework,
} from "../constants/envFlow";

const VERCEL_API = "https://api.vercel.com";
const log = createLogger({ connector: "vercel" });

function vHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export function toProjectName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "my-project"
  );
}

interface VercelEnvInfo {
  id: string;
  type?: string;
}

// Per-provision memoization — keyed by projectId, TTL 60s
const _envCache = new Map<string, { map: Map<string, VercelEnvInfo>; ts: number }>();

/** Fetch existing env vars (key → {id, type}) for a Vercel project. Results cached 60 s per project. */
async function getExistingEnvs(
  token: string,
  projectId: string,
): Promise<Map<string, VercelEnvInfo>> {
  const cached = _envCache.get(projectId);
  if (cached && Date.now() - cached.ts < 60_000) return cached.map;

  const res = await fetch(`${VERCEL_API}/v10/projects/${projectId}/env`, {
    headers: vHeaders(token),
    signal: AbortSignal.timeout(30_000),
  });
  assertNotRateLimited(res);
  if (!res.ok) return new Map();
  const data = await res.json<{
    envs?: Array<{ key: string; id: string; type?: string }>;
  }>();
  const map = new Map(
    (data.envs ?? []).map((e) => [e.key, { id: e.id, type: e.type }]),
  );
  _envCache.set(projectId, { map, ts: Date.now() });
  return map;
}

/** Public export of getExistingEnvs — used by drift reconciler. */
export async function listVercelEnvVars(
  token: string,
  projectId: string,
): Promise<Map<string, VercelEnvInfo>> {
  return getExistingEnvs(token, projectId);
}

/** Delete a single env var from a Vercel project by key name. 404 = idempotent success. */
export async function deleteVercelEnvVar(
  token: string,
  projectId: string,
  key: string,
): Promise<void> {
  const existing = await getExistingEnvs(token, projectId);
  const envId = existing.get(key)?.id;
  if (!envId) return; // already gone
  const res = await fetch(
    `${VERCEL_API}/v10/projects/${projectId}/env/${envId}`,
    {
      method: "DELETE",
      headers: vHeaders(token),
      signal: AbortSignal.timeout(30_000),
    },
  );
  assertNotRateLimited(res);
  if (!res.ok && res.status !== 404) {
    const rawBody = await res.text().catch(() => "");
    const body = redactSecretsFromText(rawBody, [token]);
    throw new Error(
      `Failed to delete Vercel env var "${key}" (${res.status}): ${body.slice(0, 200)}`,
    );
  }
  // Bust cache so subsequent reads see the deletion
  _envCache.delete(projectId);
}

/**
 * After framework detection, delete the wrong-prefix twins of the given public
 * bases from a Vercel project. Only deletes names that (a) are a prefixed form of
 * one of publicBases under a NON-target prefix, and (b) actually exist on the
 * project. Never touches user-custom vars or the correct-prefix names.
 * Returns the keys deleted.
 */
export async function narrowClientEnvPrefixes(
  token: string,
  projectId: string,
  publicBases: string[],
  framework: Framework,
): Promise<string[]> {
  const keep = FRAMEWORK_PREFIX[framework];
  const bases = publicBases.filter((b) => PUBLIC_ENV_BASES.has(b));
  if (!keep || bases.length === 0) return [];
  const wrongPrefixes = ALL_CLIENT_PREFIXES.filter((p) => p !== keep);
  const wrongNames = new Set<string>();
  for (const b of bases) for (const p of wrongPrefixes) wrongNames.add(p + b);

  const existing = await listVercelEnvVars(token, projectId);
  const toDelete = [...wrongNames].filter((k) => existing.has(k));
  for (const key of toDelete) await deleteVercelEnvVar(token, projectId, key);
  if (toDelete.length) log.info("env.narrowed", { framework, deleted: toDelete });
  return toDelete;
}

/**
 * Upsert env vars into a Vercel project.
 * New keys are bulk-POSTed; existing keys are PATCHed so stale values get updated.
 */
export async function injectVercelEnvVars(
  token: string,
  projectId: string,
  envMap: Record<string, string | undefined>,
): Promise<void> {
  const candidates = Object.entries(envMap)
    .filter(([, v]) => !!v)
    .map(([key, value]) => ({ key, value: value! }));

  if (candidates.length === 0) return;

  const existing = await getExistingEnvs(token, projectId);
  const toAdd = candidates.filter((e) => !existing.has(e.key));
  const toUpdate = candidates.filter((e) => existing.has(e.key));

  // Update existing env vars individually
  const patchFailures: string[] = [];
  await Promise.all(
    toUpdate.map(async (e) => {
      const info = existing.get(e.key)!;
      // Vercel rejects "development" in the target of a Sensitive env var
      // ("You cannot set a Sensitive Environment Variable's target to
      // development."), so that target is only valid for non-sensitive vars.
      const target =
        info.type === "sensitive"
          ? ["production", "preview"]
          : ["production", "preview", "development"];
      const res = await fetch(
        `${VERCEL_API}/v10/projects/${projectId}/env/${info.id}`,
        {
          method: "PATCH",
          headers: vHeaders(token),
          body: JSON.stringify({
            value: e.value,
            target,
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );
      assertNotRateLimited(res);
      if (!res.ok) {
        const rawBody = await res.text();
        const body = redactSecretsFromText(
          rawBody,
          toUpdate.map((u) => u.value).concat(token),
        );
        log.warn("env.patch_failed", {
          key: e.key,
          status: res.status,
          body: body.slice(0, 200),
        });
        patchFailures.push(e.key);
      }
    }),
  );
  if (patchFailures.length > 0) {
    // Bust the cache only on failure: a failed PATCH means the cached
    // id/type for that key may be stale (e.g. deleted or changed by a
    // concurrent operation), so a retry must re-fetch rather than reuse it.
    // On success the cache (which holds only id/type, never value) is still
    // accurate — busting it here would cost every step an extra Vercel API
    // subrequest for no benefit, and this DO's whole session shares one
    // Cloudflare subrequest budget across every step.
    _envCache.delete(projectId);
    throw new Error(
      `Failed to update env vars on Vercel: ${patchFailures.join(", ")}`,
    );
  }
  if (toUpdate.length > 0)
    log.info("env.updated", { keys: toUpdate.map((e) => e.key) });

  // Bulk-add new env vars
  if (toAdd.length === 0) return;
  log.info("env.injecting", { keys: toAdd.map((e) => e.key) });
  const envRes = await fetch(`${VERCEL_API}/v10/projects/${projectId}/env`, {
    method: "POST",
    headers: vHeaders(token),
    body: JSON.stringify(
      toAdd.map((e) => ({
        key: e.key,
        value: e.value,
        type: "encrypted",
        target: ["production", "preview", "development"],
      })),
    ),
    signal: AbortSignal.timeout(30_000),
  });
  assertNotRateLimited(envRes);
  if (!envRes.ok) {
    const rawBody = await envRes.text();
    const body = redactSecretsFromText(rawBody, toAdd.map((e) => e.value).concat(token));
    log.error("env.post_failed", {
      status: envRes.status,
      body: body.slice(0, 300),
    });
    throw new Error(`Failed to inject env vars into Vercel project (${envRes.status}): ${body.slice(0, 200)}`);
  }
  // Bust the cache after adding keys. Storing a fake "injected" id here would
  // break a later PATCH/DELETE within the 60s TTL (those look the id up and
  // would hit /env/injected). The next read re-fetches the real ids instead.
  _envCache.delete(projectId);
}

export interface VercelOutput {
  vercel_project_id: string;
  vercel_project_url: string;
  vercel_project_name: string;
  vercel_deployment_id?: string;
}

/** A Vercel project's git connection, as returned inside `project.link`. */
export interface VercelProjectLink {
  org?: string;
  repo?: string;
}

/**
 * Decide whether a redeploy has to relink — i.e. DELETE the Vercel project and
 * recreate it against a different GitHub repo, because Vercel's API cannot
 * PATCH a git connection onto an existing project.
 *
 * Relink is destructive: the project's custom domains, deployment history,
 * analytics and env var ids all die with it. So it may only fire on POSITIVE
 * evidence that the connected repo differs from the one on the canvas.
 * Everything we could not read is "leave the project alone" — a plain redeploy
 * is always the safe fallback, and a deploy that redeploys when it should have
 * relinked is recoverable, while the reverse is not.
 *
 * Found by a prod repro (2026-08-24) where the same node was deleted and
 * recreated on four consecutive deploys without the repo ever changing.
 */
export function shouldRelinkVercelProject(
  projectRead: { ok: boolean; link?: VercelProjectLink | null },
  desiredRepo: string,
): boolean {
  // Couldn't read the project — a rate limit, a 5xx, a network blip. Deleting
  // the user's project because a GET failed is the worst available response to
  // a transient error.
  if (!projectRead.ok) return false;

  const link = projectRead.link;
  // No git connection at all: relink is the only way to attach one. This is the
  // case the function was written for.
  if (!link?.repo) return true;

  const desired = desiredRepo.toLowerCase();
  // GitHub owner and repo names are case-insensitive, so a canvas value that
  // differs only in case is the same repo.
  if (link.org) return `${link.org}/${link.repo}`.toLowerCase() !== desired;

  // Vercel reported the bare repo name with no owner. Comparing that against
  // the owner-qualified canvas value never matches, which relinks on every
  // single deploy — compare on the repo segment instead. Trade-off: a switch to
  // a same-named repo under a different owner goes undetected in this shape,
  // which costs a stale link; the alternative costs the project itself.
  return link.repo.toLowerCase() !== (desired.split("/").pop() ?? desired);
}

/** Throws if the Vercel GitHub App integration is not installed (required to link repos). */
export async function assertVercelGitHubLinked(
  token: string,
  repoName?: string,
): Promise<void> {
  const res = await fetch(
    `${VERCEL_API}/v1/integrations/git-namespaces?provider=github`,
    { headers: vHeaders(token), signal: AbortSignal.timeout(30_000) },
  );
  if (!res.ok) return; // can't check — let it fail later with the original error
  const data = await res.json<
    { namespaces?: Array<{ slug: string }> } | Array<{ slug: string }>
  >();
  const namespaces: Array<{ slug: string }> = Array.isArray(data)
    ? data
    : ((data as any).namespaces ?? []);

  if (namespaces.length === 0) {
    throw new Error(
      "Your Vercel account is not linked to GitHub. Go to github.com/apps/vercel, install the Vercel app on your GitHub account, then try deploying again.",
    );
  }

  // If a repo is provided, check that the owner namespace has the Vercel App installed
  if (repoName) {
    const owner = repoName.split("/")[0]?.toLowerCase();
    const hasAccess = namespaces.some((n) => n.slug?.toLowerCase() === owner);
    if (!hasAccess) {
      throw new Error(await buildGitHubAccessErrorMessage(owner));
    }
  }
}

/**
 * "Not installed" reads as fixable via github.com/apps/vercel for everyone, but a repo
 * collaborator on a personal (non-org) GitHub account can never fix it that way — GitHub
 * Apps are managed only by the account owner, so collaborator access never grants
 * installation access. Probe the account type so collaborators get the real fix (org
 * migration / Vercel Team) instead of retrying a button that can't work for them.
 */
async function buildGitHubAccessErrorMessage(owner: string): Promise<string> {
  const orgAdminMessage =
    `Vercel can't access the repository because the Vercel GitHub App is not installed on "${owner}". ` +
    `Go to github.com/apps/vercel and install the app on the "${owner}" organization. ` +
    `An admin of that org must install it.`;

  try {
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(owner)}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "leenar" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return orgAdminMessage;
    const data = await res.json<{ type?: string }>();
    if (data.type === "User") {
      return (
        `Vercel can't access this repository because it's owned by a personal GitHub account ("${owner}"), ` +
        `not an organization. GitHub Apps (including Vercel's) are only manageable by the account owner — ` +
        `being added as a repo collaborator does not grant you or anyone else installation access, so ` +
        `reconnecting Vercel/GitHub won't fix this. To let collaborators deploy, "${owner}" needs to either: ` +
        `(1) move the repo into a GitHub Organization and add collaborators as org members, so the Vercel App ` +
        `can be installed at the org level, or (2) create a Vercel Team and share access through it. ` +
        `Ask "${owner}" to do one of these — there is no fix available from a collaborator's side.`
      );
    }
    return orgAdminMessage;
  } catch {
    return orgAdminMessage;
  }
}

export async function triggerVercelDeployment(
  token: string,
  opts: {
    projectId: string;
    resolvedName: string;
    repoId: number;
    defaultBranch?: string;
    idempotencyKey?: string;
  },
): Promise<{ projectUrl: string; deploymentId?: string }> {
  const refs = opts.defaultBranch ? [opts.defaultBranch] : ["main", "master"];
  const errors: string[] = [];
  for (const ref of refs) {
    const depHeaders: Record<string, string> = { ...vHeaders(token) };
    if (opts.idempotencyKey)
      depHeaders["Idempotency-Key"] = `${opts.idempotencyKey}-${ref}`;
    const depRes = await fetch(
      `${VERCEL_API}/v13/deployments?skipAutoDetectionConfirmation=1`,
      {
        method: "POST",
        headers: depHeaders,
        body: JSON.stringify({
          name: opts.resolvedName,
          project: opts.projectId,
          target: "production",
          gitSource: { type: "github", repoId: opts.repoId, ref },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    assertNotRateLimited(depRes);
    const dep = await depRes.json<{
      uid?: string;
      id?: string;
      url?: string;
      alias?: string[];
      error?: unknown;
    }>();
    if (depRes.ok) {
      const domain = dep.alias?.[0] ?? dep.url;
      log.info("deploy.triggered", { repoName: opts.resolvedName, ref });
      return {
        projectUrl: domain
          ? `https://${domain}`
          : `https://${opts.resolvedName}.vercel.app`,
        deploymentId: dep.uid ?? dep.id,
      };
    }
    errors.push(`${ref}: ${JSON.stringify(dep.error ?? depRes.status)}`);
  }
  throw new Error(
    `Vercel deployment could not be triggered on any branch (${refs.join(", ")}): ${errors.join("; ")}`,
  );
}

export async function provisionVercel(
  token: string,
  projectName: string,
  ctx: Record<string, string>,
  params: {
    projectName?: string;
    existing_repo?: string;
    vercelProjectId?: string;
    branch?: string;
    framework?: Framework;
  } = {},
  injectedEnvVars: Record<string, string> = {},
  idempotencyKey?: string,
): Promise<VercelOutput> {
  const name = toProjectName(params.projectName || projectName);

  const rawRepo = params.existing_repo || ctx.github_repo_name;
  const repoName = rawRepo
    ? rawRepo
        .replace(/^https?:\/\/github\.com\//, "")
        .replace(/\.git$/, "")
        .replace(/#.*$/, "")
        .trim()
    : undefined;

  let projectId: string;
  let resolvedName: string;
  let repoId: number | undefined;
  let defaultBranch: string | undefined;

  if (params.vercelProjectId) {
    // ── Retry path: project already created, just re-trigger deployment ──────
    projectId = params.vercelProjectId;
    resolvedName = name;
    log.info("project.reusing", { projectId });
    try {
      const getRes = await fetch(`${VERCEL_API}/v9/projects/${projectId}`, {
        headers: vHeaders(token),
        signal: AbortSignal.timeout(30_000),
      });
      assertNotRateLimited(getRes);
      if (getRes.ok) {
        const p = await getRes.json<{
          name: string;
          link?: { repoId?: number; defaultBranch?: string };
        }>();
        resolvedName = p.name;
        repoId = p.link?.repoId;
        defaultBranch = p.link?.defaultBranch;
      }
    } catch (e) {
      if (e instanceof RateLimitError) throw e;
      /* otherwise ignore — proceed with what we have */
    }
  } else {
    // ── Create project — retry with suffix on name collision ─────────────────
    type VercelProject = {
      id: string;
      name: string;
      link?: { repoId?: number; defaultBranch?: string };
    };
    let project: VercelProject | null = null;

    for (let attempt = 0; attempt <= 3 && !project; attempt++) {
      const candidateName = attempt === 0 ? name : `${name}-${attempt + 1}`;
      const body: Record<string, unknown> = { name: candidateName };
      if (repoName) body.gitRepository = { type: "github", repo: repoName };

      const createRes = await fetch(`${VERCEL_API}/v10/projects`, {
        method: "POST",
        headers: vHeaders(token),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });

      if (createRes.ok) {
        project = await createRes.json<VercelProject>();
        break;
      }

      assertNotRateLimited(createRes);

      const errBody = redactSecretsFromText(await createRes.text(), [token]);
      let msg = `${createRes.status}: ${errBody.slice(0, 200)}`;
      try {
        msg = (JSON.parse(errBody) as any).error?.message ?? msg;
      } catch {
        /* not JSON */
      }

      if (
        msg.includes("Login Connection") ||
        msg.includes("login connection")
      ) {
        throw new Error(
          "Your Vercel account is not linked to GitHub. Go to vercel.com/account/login-connections, connect your GitHub account, then try deploying again.",
        );
      }

      if (
        /install.*github.*integration|github.*integration.*first/i.test(msg)
      ) {
        throw new Error(
          'Vercel project creation failed: To link a GitHub repository, you need to install the GitHub integration first. Go to github.com/settings/installations, find the Vercel app, click Configure, and set Repository access to "All repositories". Then redeploy.',
        );
      }

      const isConflict =
        createRes.status === 409 ||
        msg.toLowerCase().includes("already exists") ||
        msg.toLowerCase().includes("already in use");
      if (!isConflict) {
        throw new Error(`Vercel project creation failed: ${msg}`);
      }

      // On first attempt, try to reuse the existing project (handles retry after partial provision failure)
      if (attempt === 0) {
        try {
          const getRes = await fetch(
            `${VERCEL_API}/v9/projects/${encodeURIComponent(candidateName)}`,
            { headers: vHeaders(token), signal: AbortSignal.timeout(30_000) },
          );
          assertNotRateLimited(getRes);
          if (getRes.ok) {
            project = await getRes.json<VercelProject>();
            log.info("project.reused_after_conflict", {
              projectId: project?.id,
            });
            break;
          }
        } catch (e) {
          if (e instanceof RateLimitError) throw e;
          /* otherwise ignore — fall through to suffix retry */
        }
      }

      if (attempt === 3) {
        throw new Error(`Vercel project creation failed: ${msg}`);
      }
      // name conflict — loop and try with suffix
    }

    if (!project)
      throw new Error("Vercel project creation failed after retries");

    projectId = project.id;
    resolvedName = project.name;
    repoId = project.link?.repoId;
    defaultBranch = project.link?.defaultBranch;

    // project.link may not be populated immediately — re-fetch if needed
    if (repoName && !repoId) {
      try {
        const getRes = await fetch(`${VERCEL_API}/v9/projects/${projectId}`, {
          headers: vHeaders(token),
          signal: AbortSignal.timeout(30_000),
        });
        assertNotRateLimited(getRes);
        if (getRes.ok) {
          const p = await getRes.json<{
            link?: { repoId?: number; defaultBranch?: string };
          }>();
          repoId = p.link?.repoId;
          defaultBranch = p.link?.defaultBranch;
          log.info("project.link_refetched", { link: p.link });
        }
      } catch (e) {
        if (e instanceof RateLimitError) throw e;
        /* otherwise ignore */
      }
    }
  }

  // ── Inject env vars (upsert — safe to run on both create and retry) ───────
  // Spread all injectedEnvVars first (includes user-defined custom vars),
  // then normalise the standard service keys that may arrive under lowercase names.
  // Resolve standard public keys under the correct prefix(es). framework
  // undefined => shotgun (all prefixes); set => single prefix. The value is
  // sourced from whatever prefix/casing arrived in ctx (only NEXT_PUBLIC_* /
  // lowercase are reliably present), and an already-present explicit prefixed
  // value is preserved (never clobbered by the fallback).
  const fw = params.framework;
  // base -> ordered value-source aliases to search in injectedEnvVars.
  const PUBLIC_VALUE_ALIASES: Record<string, string[]> = {
    SUPABASE_URL: [
      "NEXT_PUBLIC_SUPABASE_URL",
      "VITE_SUPABASE_URL",
      "PUBLIC_SUPABASE_URL",
      "supabase_url",
    ],
    SUPABASE_ANON_KEY: [
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "VITE_SUPABASE_ANON_KEY",
      "PUBLIC_SUPABASE_ANON_KEY",
      "supabase_anon_key",
    ],
    API_URL: ["NEXT_PUBLIC_API_URL", "VITE_API_URL", "PUBLIC_API_URL", "API_URL"],
    WORKER_URL: [
      "NEXT_PUBLIC_WORKER_URL",
      "VITE_WORKER_URL",
      "PUBLIC_WORKER_URL",
      "WORKER_URL",
    ],
  };
  const publicResolved: Record<string, string | undefined> = {};
  for (const [base, aliases] of Object.entries(PUBLIC_VALUE_ALIASES)) {
    const value = aliases.map((a) => injectedEnvVars[a]).find((v) => !!v);
    if (value === undefined) continue;
    for (const name of resolveEnvKeys([base], "vercel", fw)) {
      publicResolved[name] = injectedEnvVars[name] ?? value;
    }
  }

  await injectVercelEnvVars(token, projectId, {
    ...injectedEnvVars,
    ...publicResolved,
    SUPABASE_SERVICE_ROLE_KEY:
      injectedEnvVars.SUPABASE_SERVICE_ROLE_KEY ||
      injectedEnvVars.supabase_service_role,
    RESEND_API_KEY:
      injectedEnvVars.RESEND_API_KEY || injectedEnvVars.resend_api_key,
    GITHUB_REPO_URL: ctx.github_repo_url,
  });

  // Narrowing wrong-prefix twins is deliberately NOT done here. It's a
  // cosmetic cleanup (the shotgunned extra-prefix vars are inert, never
  // read by the deployed app) that costs up to one DELETE per wrong-prefix
  // key that exists — on a Workers Free plan that can be the difference
  // between a deploy landing under the 50-subrequest-per-invocation ceiling
  // and failing with "Too many subrequests" right after this step's own
  // work already succeeded (observed live, 2026-08-01/02). `narrowClientEnvPrefixes`
  // is still exported for a future out-of-band cleanup path (e.g. drift
  // reconciliation) to call once framework is durably known, outside this
  // session's shared subrequest budget.

  // ── Override production branch if user specified one ──────────────────────
  if (params.branch && repoId && params.branch !== defaultBranch) {
    try {
      await fetch(`${VERCEL_API}/v9/projects/${projectId}`, {
        method: "PATCH",
        headers: vHeaders(token),
        body: JSON.stringify({ productionBranch: params.branch }),
        signal: AbortSignal.timeout(30_000),
      });
      defaultBranch = params.branch;
      log.info("project.production_branch_set", { branch: params.branch });
    } catch {
      /* non-fatal */
    }
  } else if (params.branch) {
    defaultBranch = params.branch;
  }

  // ── Trigger deployment and capture the production URL ─────────────────────
  let projectUrl = `https://${resolvedName}.vercel.app`;
  let deploymentId: string | undefined;

  if (repoName && repoId) {
    const dep = await triggerVercelDeployment(token, {
      projectId,
      resolvedName,
      repoId,
      defaultBranch,
      idempotencyKey,
    });
    projectUrl = dep.projectUrl;
    deploymentId = dep.deploymentId;
  } else {
    log.warn("deploy.skipped", { repoId, repoName });
  }

  return {
    vercel_project_id: projectId,
    vercel_project_url: projectUrl,
    vercel_project_name: resolvedName,
    vercel_deployment_id: deploymentId,
  };
}

/**
 * Vercel's REST API cannot add git integration to an existing project via PATCH.
 * Instead: fetch the project name, delete it, recreate with gitRepository, and
 * re-inject any known env vars so the stack stays complete.
 */
export async function relinkVercelWithGitHub(
  token: string,
  projectId: string,
  repoName: string,
  extraEnvVars: Record<string, string> = {},
  idempotencyKey?: string,
): Promise<VercelOutput> {
  // 1. Fetch existing project name and snapshot env vars before delete
  const getRes = await fetch(`${VERCEL_API}/v9/projects/${projectId}`, {
    headers: vHeaders(token),
    signal: AbortSignal.timeout(30_000),
  });
  let name = "my-project";
  if (getRes.ok) {
    const p = await getRes.json<{ name: string }>();
    name = p.name;
  }

  // Snapshot existing env var values so we can restore them after recreate
  const envRes = await fetch(
    `${VERCEL_API}/v10/projects/${projectId}/env?decrypt=true`,
    {
      headers: vHeaders(token),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const existingEnvValues: Record<string, string> = {};
  if (envRes.ok) {
    const d = await envRes.json<{
      envs?: Array<{ key: string; value: string }>;
    }>();
    for (const e of d.envs ?? []) existingEnvValues[e.key] = e.value;
  }

  // 2. Delete old project
  const deleteRes = await fetch(`${VERCEL_API}/v9/projects/${projectId}`, {
    method: "DELETE",
    headers: vHeaders(token),
    signal: AbortSignal.timeout(30_000),
  });
  if (!deleteRes.ok && deleteRes.status !== 404) {
    throw new Error(
      `Failed to delete old Vercel project (${deleteRes.status}) — aborting relink to prevent duplicate`,
    );
  }
  log.info("relink.deleted", {
    projectId,
    snapshotted: Object.keys(existingEnvValues).length,
  });

  // 3. Recreate with gitRepository
  const createRes = await fetch(`${VERCEL_API}/v10/projects`, {
    method: "POST",
    headers: vHeaders(token),
    body: JSON.stringify({
      name,
      gitRepository: { type: "github", repo: repoName },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  assertNotRateLimited(createRes);
  if (!createRes.ok) {
    const errBody = redactSecretsFromText(
      await createRes.text(),
      [token, ...Object.values(existingEnvValues)],
    );
    let msg = `${createRes.status}: ${errBody.slice(0, 200)}`;
    try {
      msg = (JSON.parse(errBody) as any).error?.message ?? msg;
    } catch {
      /* not JSON */
    }
    // Log snapshot so env vars can be manually recovered if project recreation fails
    if (Object.keys(existingEnvValues).length > 0) {
      log.error("relink.create_failed_snapshot", {
        projectId,
        snapshotKeys: Object.keys(existingEnvValues),
      });
    }
    throw new Error(`Failed to recreate Vercel project with git: ${msg}`);
  }

  const newProject = await createRes.json<{
    id: string;
    name: string;
    link?: { repoId?: number; defaultBranch?: string };
  }>();
  log.info("relink.recreated", {
    newProjectId: newProject.id,
    name: newProject.name,
    repoName,
  });

  // 4. Re-inject env vars: restore snapshotted values + apply new ones (new takes precedence)
  const mergedEnv = { ...existingEnvValues, ...extraEnvVars };
  if (Object.keys(mergedEnv).length > 0) {
    await injectVercelEnvVars(token, newProject.id, mergedEnv);
  }

  // 5. Trigger deployment
  let projectUrl = `https://${newProject.name}.vercel.app`;
  // The build this kicks off is a real, asynchronous production deploy, so its
  // id has to travel back with the rest of the output: `vercel_deployment_id`
  // is the ONLY signal DeploySuccessModal has that a service is still building
  // (see useDeployFlow's success handler). Dropping it here made every relinked
  // deploy render as ready — link live — while Vercel was still building.
  let deploymentId: string | undefined;
  let repoId = newProject.link?.repoId;
  let defaultBranch = newProject.link?.defaultBranch;
  if (!repoId) {
    try {
      const getRes = await fetch(`${VERCEL_API}/v9/projects/${newProject.id}`, {
        headers: vHeaders(token),
        signal: AbortSignal.timeout(30_000),
      });
      if (getRes.ok) {
        const p = await getRes.json<{
          link?: { repoId?: number; defaultBranch?: string };
        }>();
        repoId = p.link?.repoId;
        defaultBranch = p.link?.defaultBranch;
      }
    } catch {
      /* ignore */
    }
  }
  if (repoId) {
    const refs = defaultBranch ? [defaultBranch] : ["main", "master"];
    for (const ref of refs) {
      try {
        const depHeaders: Record<string, string> = { ...vHeaders(token) };
        if (idempotencyKey)
          depHeaders["Idempotency-Key"] = `${idempotencyKey}-relink-${ref}`;
        const depRes = await fetch(
          `${VERCEL_API}/v13/deployments?skipAutoDetectionConfirmation=1`,
          {
            method: "POST",
            headers: depHeaders,
            body: JSON.stringify({
              name: newProject.name,
              project: newProject.id,
              target: "production",
              gitSource: { type: "github", repoId, ref },
            }),
            signal: AbortSignal.timeout(30_000),
          },
        );
        const dep = await depRes.json<{
          uid?: string;
          id?: string;
          url?: string;
          alias?: string[];
          error?: unknown;
        }>();
        if (depRes.ok) {
          const domain = dep.alias?.[0] ?? dep.url;
          if (domain) projectUrl = `https://${domain}`;
          deploymentId = dep.uid ?? dep.id;
          log.info("relink.deploy_triggered", { repoName, ref, deploymentId });
          break;
        } else {
          log.warn("relink.deploy_failed", { ref, error: dep.error });
        }
      } catch (e) {
        log.warn("relink.deploy_error", { ref, error: String(e) });
      }
    }
  }

  return {
    vercel_project_id: newProject.id,
    vercel_project_url: projectUrl,
    vercel_project_name: newProject.name,
    vercel_deployment_id: deploymentId,
  };
}

export interface RedeployVercelOutput {
  url: string;
  deploymentId: string | undefined;
}

/** Trigger a new production deployment for an already-provisioned Vercel project.
 *  Strategy: clone the latest production deployment via deploymentId (mirrors Vercel's
 *  own "Redeploy" button). Falls back to git-source deployment if no prior deployment exists. */
export async function redeployVercel(
  token: string,
  projectId: string,
): Promise<RedeployVercelOutput> {
  const projRes = await fetch(`${VERCEL_API}/v9/projects/${projectId}`, {
    headers: vHeaders(token),
    signal: AbortSignal.timeout(30_000),
  });
  assertNotRateLimited(projRes);
  if (!projRes.ok) {
    log.warn("redeploy.fetch_failed", { projectId });
    return { url: `https://vercel.com/dashboard`, deploymentId: undefined };
  }
  const project = await projRes.json<{
    name: string;
    link?: { repoId?: number; defaultBranch?: string };
  }>();

  // Fetch the latest production deployment to redeploy it by ID (same as Vercel's "Redeploy" button).
  const listRes = await fetch(
    `${VERCEL_API}/v6/deployments?projectId=${projectId}&target=production&limit=1&state=READY`,
    { headers: vHeaders(token), signal: AbortSignal.timeout(30_000) },
  );
  assertNotRateLimited(listRes);
  const latestDeploymentId = listRes.ok
    ? await listRes
        .json<{ deployments?: Array<{ uid: string }> }>()
        .then((d) => d.deployments?.[0]?.uid)
    : undefined;

  if (latestDeploymentId) {
    const depRes = await fetch(
      `${VERCEL_API}/v13/deployments?skipAutoDetectionConfirmation=1`,
      {
        method: "POST",
        headers: vHeaders(token),
        body: JSON.stringify({
          deploymentId: latestDeploymentId,
          name: project.name,
          target: "production",
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    assertNotRateLimited(depRes);
    const dep = await depRes.json<{
      uid?: string;
      id?: string;
      url?: string;
      alias?: string[];
      error?: unknown;
    }>();
    if (depRes.ok) {
      const domain = dep.alias?.[0] ?? dep.url;
      const url = domain ? `https://${domain}` : `https://${project.name}.vercel.app`;
      log.info("redeploy.triggered_by_id", { latestDeploymentId, domain });
      return { url, deploymentId: dep.uid ?? dep.id };
    }
    log.warn("redeploy.by_id_failed", { error: dep.error });
  }

  // Fallback: deploy from git source (for projects with no prior production deployment).
  const repoId = project.link?.repoId;
  const refs = project.link?.defaultBranch
    ? [project.link.defaultBranch]
    : ["main", "master"];

  if (!repoId) {
    log.warn("redeploy.no_git_link_and_no_deployment", { projectId });
    return { url: `https://${project.name}.vercel.app`, deploymentId: undefined };
  }

  let gitDepRes: Response | undefined;
  for (const ref of refs) {
    gitDepRes = await fetch(
      `${VERCEL_API}/v13/deployments?skipAutoDetectionConfirmation=1`,
      {
        method: "POST",
        headers: vHeaders(token),
        body: JSON.stringify({
          name: project.name,
          project: projectId,
          target: "production",
          gitSource: { type: "github", repoId, ref },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    assertNotRateLimited(gitDepRes);
    if (gitDepRes.ok) break;
    log.warn("redeploy.git_ref_failed", { ref });
  }
  if (!gitDepRes) return { url: `https://${project.name}.vercel.app`, deploymentId: undefined };
  const gitDep = await gitDepRes.json<{
    uid?: string;
    id?: string;
    url?: string;
    alias?: string[];
    error?: unknown;
  }>();
  if (gitDepRes.ok) {
    const domain = gitDep.alias?.[0] ?? gitDep.url;
    const url = domain ? `https://${domain}` : `https://${project.name}.vercel.app`;
    log.info("redeploy.triggered_from_git", { domain });
    return { url, deploymentId: gitDep.uid ?? gitDep.id };
  }
  log.warn("redeploy.failed", { error: gitDep.error });
  return { url: `https://${project.name}.vercel.app`, deploymentId: undefined };
}

export async function deprovisionVercel(
  token: string,
  params: { vercel_project_id: string },
): Promise<void> {
  const res = await fetch(
    `${VERCEL_API}/v9/projects/${params.vercel_project_id}`,
    {
      method: "DELETE",
      headers: vHeaders(token),
      signal: AbortSignal.timeout(30_000),
    },
  );
  assertNotRateLimited(res);
  if (!res.ok && res.status !== 404) {
    const err = await res
      .json<{ error?: { message: string } }>()
      .catch(() => ({}));
    throw new Error(
      `Vercel project delete failed: ${(err as any).error?.message ?? res.status}`,
    );
  }
}

export interface VercelLastDeploy {
  createdAt: number;
  state: string;
  url?: string;
}

export async function getVercelLastDeploy(
  token: string,
  projectId: string,
): Promise<VercelLastDeploy | null> {
  const res = await fetch(
    `${VERCEL_API}/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=1&state=READY`,
    { headers: vHeaders(token), signal: AbortSignal.timeout(30_000) },
  );
  if (!res.ok) return null;
  const data = await res
    .json<{
      deployments?: Array<{ createdAt: number; state: string; url?: string }>;
    }>()
    .catch(() => ({}));
  return (data as any).deployments?.[0] ?? null;
}

export async function getVercelDeploymentState(
  token: string,
  deploymentId: string,
): Promise<{ readyState: string; url: string | null }> {
  const res = await fetch(
    `${VERCEL_API}/v13/deployments/${encodeURIComponent(deploymentId)}`,
    { headers: vHeaders(token), signal: AbortSignal.timeout(30_000) },
  );
  assertNotRateLimited(res);
  if (res.status === 404) return { readyState: "UNKNOWN", url: null };
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Vercel deployment state failed (${res.status}): ${body.slice(0, 200)}`,
    );
  }
  const data = await res
    .json<{ readyState?: string; url?: string }>()
    .catch(() => ({}) as { readyState?: string; url?: string });
  return { readyState: data.readyState ?? "UNKNOWN", url: data.url ?? null };
}

export interface VercelLogEntry {
  id: string;
  type: string;
  level: number; // 0=info 1=warn 2=error 3=fatal
  message: string;
  statusCode?: number;
  path?: string;
  deploymentId?: string;
  timestamp: number; // unix ms
}

export async function getVercelRuntimeLogs(
  token: string,
  projectId: string,
  since: number,
): Promise<VercelLogEntry[]> {
  const until = Date.now();
  const url = `${VERCEL_API}/v2/projects/${encodeURIComponent(projectId)}/logs?since=${since}&until=${until}&limit=100`;
  const res = await fetch(url, { headers: vHeaders(token), signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return [];
  const data = await res.json<{ logs?: VercelLogEntry[] }>().catch(() => ({}));
  return (data as any).logs ?? [];
}

/** Promote (roll back to) a specific Vercel deployment by ID. */
export async function promoteVercelDeployment(
  token: string,
  projectId: string,
  deploymentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(
    `${VERCEL_API}/v10/projects/${encodeURIComponent(projectId)}/promote/${encodeURIComponent(deploymentId)}`,
    {
      method: "POST",
      headers: vHeaders(token),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (res.status === 404 || res.status === 410) {
    return { ok: false, error: "deployment not found or garbage-collected" };
  }
  if (res.ok) {
    return { ok: true };
  }
  const body = redactSecretsFromText(await res.text().catch(() => ""), [token]);
  let msg = `${res.status}`;
  try {
    msg = (JSON.parse(body) as any).error?.message ?? msg;
  } catch {
    /* not JSON */
  }
  return { ok: false, error: msg };
}

/** List recent production deployments for a Vercel project. Returns [] on any error. */
export async function listVercelProductionDeployments(
  token: string,
  projectId: string,
): Promise<Array<{ uid: string; createdAt: number; url: string }>> {
  const res = await fetch(
    `${VERCEL_API}/v6/deployments?projectId=${encodeURIComponent(projectId)}&target=production&state=READY&limit=10`,
    { headers: vHeaders(token), signal: AbortSignal.timeout(30_000) },
  );
  if (!res.ok) return [];
  const data = await res
    .json<{ deployments?: Array<{ uid: string; createdAt: number; url: string }> }>()
    .catch(() => ({}));
  return (data as any).deployments ?? [];
}

export interface VercelObsResult {
  status: "ok";
  successRate7d: number;
  totalDeploys7d: number;
  avgBuildMs: number;
}

export async function getVercelObservability(
  token: string,
  projectId: string,
): Promise<VercelObsResult | { status: "error" }> {
  const from = Date.now() - 7 * 24 * 60 * 60 * 1000;
  try {
    const res = await fetch(
      `${VERCEL_API}/v6/deployments?projectId=${encodeURIComponent(projectId)}&from=${from}&limit=100`,
      { headers: vHeaders(token), signal: AbortSignal.timeout(30_000) },
    );
    if (!res.ok) return { status: "error" };
    const data = await res.json<{
      deployments?: Array<{ uid: string; state: string; createdAt: number; ready: number | null }>
    }>().catch(() => ({}));
    const deployments = (data as any).deployments ?? [];

    const total = deployments.length;
    const readyDeploys = deployments.filter((d: any) => d.state === "READY");
    const successRate7d = total === 0 ? 0 : readyDeploys.length / total;

    const buildDurations = readyDeploys
      .filter((d: any) => d.createdAt && d.ready)
      .map((d: any) => (d.ready as number) - (d.createdAt as number));
    const avgBuildMs =
      buildDurations.length === 0
        ? 0
        : Math.round(buildDurations.reduce((s: number, v: number) => s + v, 0) / buildDurations.length);

    return { status: "ok", successRate7d, totalDeploys7d: total, avgBuildMs };
  } catch {
    return { status: "error" };
  }
}

/**
 * Fetch Vercel billing charges for a date range (FOCUS/JSONL format).
 * Returns one aggregated record per (vercelProjectId, date).
 * Returns [] on any error — callers must handle missing data gracefully.
 */
export async function getVercelBillingCharges(
  token: string,
  from: string, // YYYY-MM-DD
  to: string,   // YYYY-MM-DD (inclusive)
): Promise<Array<{ vercelProjectId: string; date: string; amountUsd: number }>> {
  try {
    const url = `${VERCEL_API}/v1/billing/charges?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await fetch(url, {
      headers: vHeaders(token),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return [];

    const text = await res.text();
    const lines = text.split("\n").filter((l) => l.trim());

    const totals = new Map<string, number>();
    for (const line of lines) {
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      const projectId =
        (row["Tags"] as Record<string, string> | undefined)?.["ProjectId"] ??
        (row["projectId"] as string | undefined);
      const date =
        (row["ChargePeriodStart"] as string | undefined)?.slice(0, 10) ??
        (row["date"] as string | undefined);
      const amount =
        typeof row["BilledCost"] === "number"
          ? row["BilledCost"]
          : typeof row["Amount"] === "number"
            ? row["Amount"]
            : 0;
      if (!projectId || !date) continue;
      const key = `${projectId}::${date}`;
      totals.set(key, (totals.get(key) ?? 0) + amount);
    }

    return Array.from(totals.entries()).map(([key, amountUsd]) => {
      const [vercelProjectId, date] = key.split("::");
      return { vercelProjectId, date, amountUsd };
    });
  } catch {
    return [];
  }
}
