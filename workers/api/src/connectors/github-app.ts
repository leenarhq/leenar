import { createLogger } from '../logger'
import { redactSecretsFromText } from '../utils'
import { assertNotRateLimited } from './errors'

const GH_API = 'https://api.github.com'
const log = createLogger({ connector: 'github-app' })

// Pinned to a commit SHA (not the mutable `v3` tag) to prevent supply-chain
// risk if the tag is ever repointed. SHA verified against GitHub API as
// cloudflare/wrangler-action's v3.15.0 release.
const WRANGLER_ACTION_REF = 'cloudflare/wrangler-action@9acf94ace14e7dc412b076f2c5c20b8ce93c79cd'
const WRANGLER_ACTION_VERSION_COMMENT = 'v3.15.0'

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'Leenar/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

// Every GitHub API call MUST be time-bounded. Workers `fetch` has no default
// timeout, so a stalled connection hangs the awaiting caller forever — and
// because several of these run inline in the provision step path (e.g.
// pushLeenarCommitAsApp / createGitHubDeployment after "Vercel ready"), a hang
// here strands the whole deploy before it can finalize. Default 30s unless the
// caller passes its own signal.
function ghFetch(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(30_000),
  })
}

/** Parse PEM private key and import as CryptoKey for RS256 signing. */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemBody = pem
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, '')
    .replace(/-----END RSA PRIVATE KEY-----/, '')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')

  const der = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))

  // GitHub App private keys are PKCS#1 — wrap in PKCS#8 for Web Crypto
  const pkcs8 = pkcs1ToPkcs8(der)

  return crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

/**
 * GitHub App private keys come as PKCS#1 RSA keys.
 * Web Crypto only accepts PKCS#8, so we wrap the PKCS#1 payload.
 */
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  // PKCS#8 wrapper for RSA (OID 1.2.840.113549.1.1.1)
  const algorithmIdentifier = new Uint8Array([
    0x30, 0x0d,                         // SEQUENCE
    0x06, 0x09,                         // OID tag + length
    0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, // rsaEncryption OID
    0x05, 0x00,                         // NULL
  ])

  const privateKeyOctetString = new Uint8Array(pkcs1.length + 4)
  privateKeyOctetString[0] = 0x04      // OCTET STRING
  const lenBytes = encodeLength(pkcs1.length)
  privateKeyOctetString.set(lenBytes, 1)
  privateKeyOctetString.set(pkcs1, 1 + lenBytes.length)

  const version = new Uint8Array([0x02, 0x01, 0x00]) // INTEGER 0
  const innerSeqBody = concatBytes(version, algorithmIdentifier, privateKeyOctetString.slice(0, 1 + lenBytes.length + pkcs1.length))
  const innerSeq = wrapSequence(innerSeqBody)
  return innerSeq
}

function encodeLength(len: number): Uint8Array {
  if (len < 0x80) return new Uint8Array([len])
  if (len < 0x100) return new Uint8Array([0x81, len])
  return new Uint8Array([0x82, (len >> 8) & 0xff, len & 0xff])
}

function wrapSequence(body: Uint8Array): Uint8Array {
  const lenBytes = encodeLength(body.length)
  const result = new Uint8Array(1 + lenBytes.length + body.length)
  result[0] = 0x30
  result.set(lenBytes, 1)
  result.set(body, 1 + lenBytes.length)
  return result
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) { out.set(a, offset); offset += a.length }
  return out
}

function base64urlEncode(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// Module-level cache: installationId → { token, expiresAt }
// Installation tokens last 1 hour; we cache for 50 min to be safe.
const _tokenCache = new Map<number, { token: string; expiresAt: number }>()
const TOKEN_TTL_MS = 50 * 60 * 1000

/** Generate a signed JWT for GitHub App authentication (valid 9 minutes). */
async function signAppJWT(appId: string, privateKeyPem: string): Promise<string> {
  const key = await importPrivateKey(privateKeyPem)
  const now = Math.floor(Date.now() / 1000)

  const header  = base64urlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const payload = base64urlEncode(new TextEncoder().encode(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId })))
  const message = `${header}.${payload}`

  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(message),
  )

  return `${message}.${base64urlEncode(sig)}`
}

/** Find the GitHub App installation for a given repo. */
async function getInstallationId(jwt: string, repoFullName: string): Promise<number | null> {
  const res = await ghFetch(`${GH_API}/repos/${repoFullName}/installation`, {
    headers: ghHeaders(jwt),
  })
  if (!res.ok) return null
  const data = await res.json<{ id: number }>()
  return data.id
}

/** Exchange an App JWT for an installation access token (cached 50 min per isolate). */
async function getInstallationToken(jwt: string, installationId: number): Promise<string> {
  const cached = _tokenCache.get(installationId)
  if (cached && Date.now() < cached.expiresAt) return cached.token

  const res = await ghFetch(`${GH_API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: ghHeaders(jwt),
  })
  if (!res.ok) {
    const err = redactSecretsFromText(await res.text(), [jwt])
    throw new Error(`GitHub App token exchange failed: ${res.status} ${err.slice(0, 100)}`)
  }
  const data = await res.json<{ token: string }>()
  _tokenCache.set(installationId, { token: data.token, expiresAt: Date.now() + TOKEN_TTL_MS })
  return data.token
}

/**
 * Push the .leenar marker file using the GitHub App installation token.
 * Commit appears as "leenar-deploy[bot]" — no personal email issues.
 */
export async function pushLeenarCommitAsApp(
  appId: string,
  privateKeyPem: string,
  repoFullName: string,
  brand: { name: string; url: string },
): Promise<boolean> {
  const jwt            = await signAppJWT(appId, privateKeyPem)
  const installationId = await getInstallationId(jwt, repoFullName)
  if (!installationId) {
    log.warn('commit.no_installation', { repoFullName })
    return false
  }
  const token = await getInstallationToken(jwt, installationId)

  // Get existing file SHA if present — GitHub requires it for updates
  const getRes = await ghFetch(`${GH_API}/repos/${repoFullName}/contents/.leenar`, {
    headers: ghHeaders(token),
  })
  const existingSha = getRes.ok
    ? (await getRes.json<{ sha?: string }>()).sha
    : undefined

  const body: Record<string, string> = {
    message: `Added: ${brand.name}`,
    content: btoa(`${brand.url}\n`),
  }
  if (existingSha) body.sha = existingSha

  const res = await ghFetch(`${GH_API}/repos/${repoFullName}/contents/.leenar`, {
    method: 'PUT',
    headers: ghHeaders(token),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = redactSecretsFromText(await res.text(), [token, jwt])
    log.warn('commit.push_failed', { status: res.status, body: err.slice(0, 100) })
    return false
  }
  log.info('commit.pushed', { repoFullName })
  return true
}

/**
 * Build the YAML for `.github/workflows/leenar-deploy.yml`.
 * Pure function, no I/O — always triggers on `workflow_dispatch`; optionally
 * also on push to `main` (off by default — Leenar dispatches manually).
 */
/** A repo-relative path safe to interpolate into a `run:` shell block: plain
 *  segments only — no traversal, no whitespace, no shell metacharacters. */
const SAFE_REL_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/

function assertSafeWorkingDirectory(wd: string): void {
  if (!SAFE_REL_PATH.test(wd) || wd.split('/').includes('..')) {
    throw new Error(
      `Refusing to build a deploy workflow: workingDirectory "${wd}" is not a plain relative path.`,
    )
  }
}

export function buildLeenarDeployWorkflowYaml(opts?: {
  workingDirectory?: string
  onPush?: boolean
  /** When set, deploy the Worker under this exact name (`wrangler deploy --name`).
   *  Used for native branch deploys so the branch Worker is a SEPARATE resource
   *  and never overwrites the trunk Worker named in wrangler.toml. */
  workerName?: string
}): string {
  const onLines = opts?.onPush
    ? [
        'on:',
        '  workflow_dispatch: {}',
        '  push:',
        '    branches: [main]',
      ]
    : [
        'on:',
        '  workflow_dispatch: {}',
      ]

  // Quote/scope the name defensively — it is Leenar-generated (`<slug>-<key>`),
  // but keep the wrangler flag on one line so the YAML stays a scalar.
  const deployCommand = opts?.workerName
    ? `deploy --name ${opts.workerName}`
    : 'deploy'
  const withLines = [
    '          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}',
    '          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
    `          command: ${deployCommand}`,
  ]
  if (opts?.workingDirectory) {
    assertSafeWorkingDirectory(opts.workingDirectory)
    withLines.push(`          workingDirectory: ${opts.workingDirectory}`)
  }

  // wrangler-action installs WRANGLER, not the project's own dependencies —
  // its `packageManager` input is documented as "the package manager you'd
  // like to use to install and run wrangler", and `preCommands` exists
  // precisely for this. Without an install, `wrangler deploy` fails to bundle
  // any Worker that imports an npm package.
  //
  // Prefer the repo root: in a monorepo the workspace install lives there even
  // when the Worker is in a subdirectory (which is how Leenar's own deploy
  // works). Fall back to the workingDirectory for a standalone Worker that
  // carries its own manifest, and no-op entirely when there is no package.json
  // at all, so a zero-dependency single-file Worker still deploys.
  const installLines = [
    '      - name: Install dependencies',
    '        shell: bash',
    '        run: |',
    '          set -euo pipefail',
    '          dir="."',
  ]
  if (opts?.workingDirectory) {
    installLines.push(
      `          if [ ! -f package.json ] && [ -f "${opts.workingDirectory}/package.json" ]; then dir="${opts.workingDirectory}"; fi`,
    )
  }
  installLines.push(
    '          if [ ! -f "$dir/package.json" ]; then',
    // ASCII only: this YAML is base64'd with btoa(), which is latin1-only and
    // throws InvalidCharacterError on so much as an em-dash.
    '            echo "No package.json found - skipping dependency install."',
    '            exit 0',
    '          fi',
    '          cd "$dir"',
    '          if [ -f package-lock.json ]; then',
    '            npm ci',
    '          elif [ -f pnpm-lock.yaml ]; then',
    '            corepack enable && pnpm install --frozen-lockfile',
    '          elif [ -f yarn.lock ]; then',
    '            corepack enable && yarn install --frozen-lockfile',
    '          else',
    '            npm install',
    '          fi',
  )

  const lines = [
    'name: Leenar Deploy',
    ...onLines,
    'jobs:',
    '  deploy:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    ...installLines,
    `      - uses: ${WRANGLER_ACTION_REF} # ${WRANGLER_ACTION_VERSION_COMMENT}`,
    '        with:',
    ...withLines,
    '',
  ]
  return lines.join('\n')
}

/**
 * Verify the repo has a Wrangler config before we bother writing a workflow
 * that would just fail. Checks wrangler.toml, then falls back to
 * wrangler.jsonc. Throws if neither exists.
 */
export async function assertWranglerConfigExists(
  token: string,
  repoFullName: string,
  workingDirectory?: string,
): Promise<void> {
  const prefix = workingDirectory ? `${workingDirectory}/` : ''

  const tryFetch = async (filename: string) => {
    const res = await ghFetch(`${GH_API}/repos/${repoFullName}/contents/${prefix}${filename}`, {
      headers: ghHeaders(token),
    })
    return res
  }

  const tomlRes = await tryFetch('wrangler.toml')
  if (tomlRes.ok) return
  if (tomlRes.status !== 404) {
    const err = redactSecretsFromText(await tomlRes.text(), [token])
    throw new Error(`GitHub contents lookup failed: ${tomlRes.status} ${err.slice(0, 100)}`)
  }

  const jsoncRes = await tryFetch('wrangler.jsonc')
  if (jsoncRes.ok) return
  if (jsoncRes.status !== 404) {
    const err = redactSecretsFromText(await jsoncRes.text(), [token])
    throw new Error(`GitHub contents lookup failed: ${jsoncRes.status} ${err.slice(0, 100)}`)
  }

  throw new Error(
    `No wrangler.toml or wrangler.jsonc found in ${repoFullName}${workingDirectory ? `/${workingDirectory}` : ''}. Add a Wrangler config file to your repo before deploying.`,
  )
}

/**
 * Write the Leenar deploy workflow file using the GitHub App installation
 * token. Mirrors `pushLeenarCommitAsApp`'s auth + write flow, but hard-throws
 * if the repo has no Wrangler config (a real, user-actionable failure that
 * must be distinguished from "no installation" or "write failed").
 */
export async function writeWorkflowFileAsApp(
  appId: string,
  privateKeyPem: string,
  repoFullName: string,
  opts?: {
    workingDirectory?: string
    onPush?: boolean
    workerName?: string
    /** Target branch to write the workflow to. Defaults to the repo default
     *  branch. Native branch deploys write a `--name`-scoped workflow ONLY to
     *  the branch ref so the trunk workflow (which deploys the trunk Worker) is
     *  never modified. */
    branch?: string
  },
): Promise<boolean> {
  const jwt            = await signAppJWT(appId, privateKeyPem)
  const installationId = await getInstallationId(jwt, repoFullName)
  if (!installationId) {
    log.warn('workflow.no_installation', { repoFullName })
    return false
  }
  const token = await getInstallationToken(jwt, installationId)

  await assertWranglerConfigExists(token, repoFullName, opts?.workingDirectory)

  const path = '.github/workflows/leenar-deploy.yml'
  const refQuery = opts?.branch ? `?ref=${encodeURIComponent(opts.branch)}` : ''

  // Get existing file SHA if present — GitHub requires it for updates. Scope the
  // lookup to the target branch so a branch write doesn't pick up the default
  // branch's SHA (which would 409).
  const getRes = await ghFetch(`${GH_API}/repos/${repoFullName}/contents/${path}${refQuery}`, {
    headers: ghHeaders(token),
  })
  const existingSha = getRes.ok
    ? (await getRes.json<{ sha?: string }>()).sha
    : undefined

  const yaml = buildLeenarDeployWorkflowYaml(opts)

  const body: Record<string, string> = {
    message: 'Add: Leenar deploy workflow',
    content: btoa(yaml),
  }
  if (existingSha) body.sha = existingSha
  if (opts?.branch) body.branch = opts.branch

  const res = await ghFetch(`${GH_API}/repos/${repoFullName}/contents/${path}`, {
    method: 'PUT',
    headers: ghHeaders(token),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = redactSecretsFromText(await res.text(), [token, jwt])
    log.warn('workflow.write_failed', { status: res.status, body: err.slice(0, 100) })
    return false
  }
  log.info('workflow.written', { repoFullName })
  return true
}

/**
 * Resolve a GitHub App installation access token for a specific repo.
 * Same JWT -> installationId -> token flow as `pushLeenarCommitAsApp`;
 * returns `null` (not a throw) if there's no installation for the repo.
 */
export async function getInstallationTokenForRepo(
  appId: string,
  privateKeyPem: string,
  repoFullName: string,
): Promise<string | null> {
  const jwt            = await signAppJWT(appId, privateKeyPem)
  const installationId = await getInstallationId(jwt, repoFullName)
  if (!installationId) {
    log.warn('token.no_installation', { repoFullName })
    return null
  }
  return getInstallationToken(jwt, installationId)
}

/**
 * Dispatch a `workflow_dispatch` event for a workflow file on a given ref.
 * GitHub returns 204 with no body on success.
 */
export async function dispatchWorkflow(
  token: string,
  repoFullName: string,
  workflowFile: string,
  ref: string,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const res = await ghFetch(
    `${GH_API}/repos/${repoFullName}/actions/workflows/${workflowFile}/dispatches`,
    {
      method: 'POST',
      headers: ghHeaders(token),
      body: JSON.stringify({ ref }),
      signal: opts?.signal ?? AbortSignal.timeout(30_000),
    },
  )
  assertNotRateLimited(res)
  if (!res.ok) {
    const err = redactSecretsFromText(await res.text(), [token])
    throw new Error(`GitHub workflow dispatch failed: ${res.status} ${err.slice(0, 100)}`)
  }
}

/**
 * Find the most recent `workflow_dispatch` run for a workflow file, created
 * after `dispatchedAfter` (an ISO timestamp captured immediately before
 * calling `dispatchWorkflow`). Returns `null` if no matching run has shown
 * up yet (normal immediately after dispatch — caller should retry).
 *
 * Correlation strategy: `leenar-deploy.yml` is a Leenar-only workflow file,
 * so filtering that specific workflow's runs by `created > dispatchedAfter`
 * is a sufficient, race-tolerant way to find "the run we just dispatched"
 * without a run ID handed back synchronously (the dispatch API doesn't
 * return one).
 */
export async function findWorkflowRun(
  token: string,
  repoFullName: string,
  workflowFile: string,
  dispatchedAfter: string,
): Promise<{ id: number; status: string; conclusion: string | null; html_url: string } | null> {
  const url =
    `${GH_API}/repos/${repoFullName}/actions/workflows/${workflowFile}/runs` +
    `?event=workflow_dispatch&created=${encodeURIComponent(`>${dispatchedAfter}`)}`
  const res = await ghFetch(url, { headers: ghHeaders(token) })
  if (!res.ok) {
    const err = redactSecretsFromText(await res.text(), [token])
    throw new Error(`GitHub workflow run lookup failed: ${res.status} ${err.slice(0, 100)}`)
  }
  const data = await res.json<{
    workflow_runs: Array<{ id: number; status: string; conclusion: string | null; html_url: string }>
  }>()
  return data.workflow_runs[0] ?? null
}

/**
 * Best-effort diagnostic tail for a failed workflow run, built from check-run
 * annotations (NOT the `/actions/runs/{id}/logs` endpoint, which returns a
 * ZIP archive — there's no unzip capability worth building for this).
 *
 * Never throws: a failure to fetch diagnostic detail must never mask the
 * real failure (the run itself failing).
 */
export async function getWorkflowRunFailureTail(
  token: string,
  repoFullName: string,
  runId: number,
  maxChars = 2000,
): Promise<string> {
  try {
    const jobsRes = await ghFetch(`${GH_API}/repos/${repoFullName}/actions/runs/${runId}/jobs`, {
      headers: ghHeaders(token),
    })
    if (!jobsRes.ok) {
      return `(could not retrieve failure detail — see run ${runId})`
    }
    const jobsData = await jobsRes.json<{
      jobs: Array<{ id: number; name: string; conclusion: string | null }>
    }>()
    const failedJobs = (jobsData.jobs ?? []).filter(j => j.conclusion !== 'success')

    const messages: string[] = []
    for (const job of failedJobs) {
      try {
        const annRes = await ghFetch(`${GH_API}/repos/${repoFullName}/check-runs/${job.id}/annotations`, {
          headers: ghHeaders(token),
        })
        if (!annRes.ok) continue
        const annotations = await annRes.json<Array<{ title?: string; message?: string }>>()
        for (const ann of annotations) {
          const text = [ann.title, ann.message].filter(Boolean).join(': ')
          if (text) messages.push(text)
        }
      } catch {
        // best-effort per-job — keep collecting from other jobs
      }
    }

    if (messages.length === 0) {
      // No step annotations found (e.g. infra-level failure) — fall back to
      // naming the failed job(s) so the caller gets *something* actionable.
      for (const job of failedJobs) {
        messages.push(`${job.name}: ${job.conclusion ?? 'unknown'}`)
      }
    }

    return messages.join('\n').slice(0, maxChars)
  } catch {
    return `(could not retrieve failure detail — see run ${runId})`
  }
}

/**
 * Best-effort: read the Worker's `name` out of the repo's wrangler.toml
 * (falling back to wrangler.jsonc), the same files `assertWranglerConfigExists`
 * already checks for existence. Returns `null` if neither file is readable or
 * neither contains a parseable name — this does not need to handle
 * environment-specific name overrides (e.g. `[env.production]` blocks).
 */
export async function getWranglerWorkerName(
  token: string,
  repoFullName: string,
  workingDirectory?: string,
): Promise<string | null> {
  const prefix = workingDirectory ? `${workingDirectory}/` : ''

  const fetchContent = async (filename: string): Promise<string | null> => {
    const res = await ghFetch(`${GH_API}/repos/${repoFullName}/contents/${prefix}${filename}`, {
      headers: ghHeaders(token),
    })
    if (!res.ok) return null
    const data = await res.json<{ content?: string }>()
    if (!data.content) return null
    return atob(data.content.replace(/\n/g, ''))
  }

  try {
    const toml = await fetchContent('wrangler.toml')
    if (toml) {
      // Match `name = "..."` before any `[section]` header (top-level key only).
      const topLevel = toml.split(/^\[/m)[0]
      const m = topLevel.match(/^name\s*=\s*"([^"]+)"/m)
      if (m) return m[1]
    }
  } catch {
    /* fall through to jsonc */
  }

  try {
    const jsonc = await fetchContent('wrangler.jsonc')
    if (jsonc) {
      const withoutComments = jsonc.replace(/^\s*\/\/.*$/gm, '')
      const parsed = JSON.parse(withoutComments) as { name?: string }
      if (parsed.name) return parsed.name
    }
  } catch {
    /* best-effort — return null below */
  }

  return null
}

/**
 * Create a GitHub Deployment record and immediately mark it as success.
 * This makes Leenar appear in the repo's Deployments panel.
 */
export async function createGitHubDeployment(
  appId: string,
  privateKeyPem: string,
  repoFullName: string,
  ref: string,
  environmentUrl: string,
  brand: { name: string; url: string },
): Promise<void> {
  const jwt            = await signAppJWT(appId, privateKeyPem)
  const installationId = await getInstallationId(jwt, repoFullName)
  if (!installationId) {
    log.warn('deploy.no_installation', { repoFullName })
    return
  }

  const token = await getInstallationToken(jwt, installationId)

  // Create deployment
  const depRes = await ghFetch(`${GH_API}/repos/${repoFullName}/deployments`, {
    method: 'POST',
    headers: ghHeaders(token),
    body: JSON.stringify({
      ref,
      environment:           'production',
      description:           `Deployed with ${brand.name}`,
      auto_merge:            false,
      required_contexts:     [],
      transient_environment: false,
      production_environment: true,
    }),
  })
  if (!depRes.ok) {
    const err = redactSecretsFromText(await depRes.text(), [token, jwt])
    log.warn('deploy.create_failed', { status: depRes.status, body: err.slice(0, 100) })
    return
  }
  const dep = await depRes.json<{ id: number }>()

  // Set status to success
  const statusRes = await ghFetch(`${GH_API}/repos/${repoFullName}/deployments/${dep.id}/statuses`, {
    method: 'POST',
    headers: ghHeaders(token),
    body: JSON.stringify({
      state:           'success',
      environment_url: environmentUrl,
      log_url:         brand.url,
      description:     `Deployed with ${brand.name}`,
    }),
  })
  if (!statusRes.ok) {
    const err = redactSecretsFromText(await statusRes.text(), [token, jwt])
    log.warn('deploy.status_update_failed', { status: statusRes.status, body: err.slice(0, 100) })
    return
  }

  log.info('deploy.created', { repoFullName, ref, deploymentId: dep.id })
}
