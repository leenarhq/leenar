# Self-hosting Leenar (Docker demo)

`docker compose up` runs the full Leenar stack — web console, API worker, and
a self-hosted Supabase subset (Postgres/Auth/PostgREST/Realtime via Kong) — on
your own machine. No Cloudflare account, no cloud Supabase project.

## a. Prerequisites

- **Docker** (Docker Desktop or a Docker Engine + Compose v2 install). Verify
  with `docker compose version`.
- **An OpenAI API key.** Leenar's chat→canvas engine calls the OpenAI
  chat-completions API (`gpt-4o`) — without a real key, chat will fail. Get one
  at <https://platform.openai.com/api-keys>.
- `openssl` on your `PATH` (used by `setup.sh` to generate local secrets — present
  by default on macOS/Linux).

## b. Quick start

Run these from the repo root (where `docker-compose.yml` lives):

```bash
bash docker/setup.sh         # writes .env (repo root), fills random secrets
$EDITOR .env                 # set OPENAI_API_KEY=sk-...
docker compose up            # add -d to run in the background
```

First boot builds the `api` and `web` images (a couple of minutes) and pulls
the Supabase images. Wait for `docker compose ps` to show every service as
`healthy`, or watch the logs settle (`docker compose logs -f`).

## c. Sign in

`setup.sh` generates a first account and prints it:

```
✓ Admin account: admin@leenar.local / 9f2c…
```

A one-shot `bootstrap` service creates that account on first boot, so open
<http://localhost:8080> and sign in with those credentials — no browser signup
step. They live in `.env` as `LEENAR_ADMIN_EMAIL` / `LEENAR_ADMIN_PASSWORD`, so
look them up there if you lose the terminal, or edit them *before* the first
`docker compose up` to choose your own.

Clearing either variable turns the bootstrap off; then create an account in the
browser at <http://localhost:8080/signup> with any email + password. Email
confirmation is disabled either way, so the account is active immediately with
no inbox required.

This build hides the Leenar Cloud invite gate, plus the sign-in controls that
cannot work here: Google/GitHub OAuth (no provider apps are configured, so
GoTrue rejects them) and password reset / magic link (the bundled auth
container runs a noop mail client — it accepts the request and never sends
anything).

Editing `LEENAR_ADMIN_PASSWORD` after the first boot does **not** reset the
account. The bootstrap is create-only on purpose — re-applying the .env value
on every `docker compose up` would silently undo a password you changed in the
app. To reset one, go through Postgres:

```bash
docker compose exec db psql -U postgres -c \
  "update auth.users set encrypted_password = crypt('newpassword', gen_salt('bf')) where email = 'admin@leenar.local';"
```

## d. Chat → canvas

In the console, describe the infrastructure you want (e.g. "a Postgres-backed
API on Vercel with a GitHub repo"). The AI turns the conversation into
nodes/edges on the canvas — services, triggers, and the connections between
them. This step needs the real `OPENAI_API_KEY` from step (b).

## e. Connect a deploy provider and deploy

This self-host build has no OAuth apps configured, so provider connections use
**pasted Personal Access Tokens (PATs)** instead of "Connect via OAuth" (which
is a Leenar Cloud–only flow and is hidden here).

Go to **Settings → Integrations** and paste a token for each provider your
canvas needs:

- **GitHub** — <https://github.com/settings/tokens> (a classic PAT with `repo`
  scope is enough for most flows)
- **Vercel** — <https://vercel.com/account/tokens>
- **Cloudflare** — <https://dash.cloudflare.com/profile/api-tokens>
- **Supabase** — <https://supabase.com/dashboard/account/tokens>

Once the providers your canvas needs are connected, hit **Deploy**. This
creates real resources in those real cloud accounts — it is not a simulated
deploy.

> **Note:** a few GitHub-side niceties (the "deployed by Leenar" branding
> commit and the GitHub Deployment status marker) are driven by a GitHub App
> that this self-host build does not configure, so they are skipped. Your
> Vercel project and GitHub repository are still provisioned for real via your
> PAT — only those two cosmetic GitHub markers no-op.

## f. Drive it from an AI client (MCP)

Your stack serves an MCP endpoint at `/api/mcp` on the API worker, so Claude
Code, Cursor or any other MCP client can read and edit a canvas directly.

Create a token under **Settings → API Tokens** — the reveal screen prints a
ready-to-paste `claude mcp add` line with the key already in it. It looks like:

```bash
claude mcp add --transport http leenar http://localhost:8787/api/mcp \
  --header "Authorization: Bearer lnr_..."
```

Then `claude mcp list` should show `leenar: connected`.

**What it exposes.** The self-hosted server advertises the canvas tools and
nothing else: read a workspace (`get_canvas`, `list_workflows`,
`list_environments`, `list_connections`, `get_workflow_env_vars`) and edit one
(`add_service`, `connect_services`, `update_node`, `remove_node`,
`remove_edge`), plus the provider listings and the builder importer. The
autonomy tools — deploys, drift reconciliation, incident actions, cost — are
Leenar Cloud's and are not part of this build; `tools/list` never mentions them.

**Scopes matter here.** A read-only token can call the read tools only; every
canvas edit needs a **read & write** token. Deploying is still a REST call
(`POST /api/projects/:id/provision`) or the Deploy button, not an MCP tool.

If the console is on a different host than `localhost:8787`, use the same URL
you put in `VITE_API_URL` / `API_URL` — the MCP endpoint lives on the API
worker, not on the web worker.

## g. Production warning

**This is a local demo, not a production-hardened deployment.** Before
relying on it for anything beyond trying Leenar out:

- **The Supabase JWT/anon/service_role keys are fixed, public, demo values**
  (checked into `.env.example`, the same for every install of this repo).
  They are fine for a local demo because nothing here is reachable from the
  internet — but they must be **rotated** (new `SUPABASE_JWT_SECRET`, and
  matching self-minted `anon`/`service_role` JWTs) before you expose this
  stack to anyone else or put real data in it.
- **Email confirmation is disabled** (`GOTRUE_MAILER_AUTOCONFIRM=true`) so
  signup works with no SMTP setup. Anyone who can reach port 8080 can create
  an account with any email address, confirmed, without ever owning that
  inbox. Fine for a single-user local demo; not fine on a shared network.
- **The first account's password sits in `.env` in plaintext.** `setup.sh`
  generates a random 96-bit one, but it lands on disk in the same file as your
  encryption key and provider tokens. Treat `.env` as a secret file, and change
  the password from inside the app if this stack lives anywhere but your own
  machine.
- **No TLS, no domain, no backup strategy, no upgrade path.** This compose
  file is meant for `localhost`, run-and-throw-away or run-and-keep-locally
  usage — not a production install.
- **Do not expose this stack beyond `localhost`, and do not run it on a cloud
  VM with a reachable instance-metadata endpoint.** The `api` container
  (workerd) needs outbound access to private/internal IPs to reach the `kong`
  service over the Docker bridge network — that same open egress means that if
  this stack runs on a cloud VM, it could also reach that cloud's metadata
  endpoint (e.g. `169.254.169.254`), which is a well-known SSRF path to
  instance credentials. Keep this stack on your local machine, behind no
  public ingress.

## Smoke-test checklist

Use this after `docker compose up` to confirm the stack is actually working,
in the order a fresh user would hit it:

- [ ] `docker compose ps` — `db`, `kong`, `api` and `web` show `healthy`, and
      `auth`, `rest` and `realtime` show `running` with a blank health column.
      Those three ship no healthcheck of their own, so a blank there is normal
      — `api` reaching `healthy` is what proves they are actually serving.
      `bootstrap` shows `exited`: it is a one-shot that creates the first
      account and stops.
- [ ] `curl -L http://localhost:8080/` → `200` (the web console loads). Note:
      `/` itself 307-redirects to `/console` — the marketing landing page is a
      Leenar Cloud–only route, not part of this self-host build — so use
      `-L` to follow the redirect, or curl `/console` directly.
- [ ] `curl http://localhost:8787/health` → `200` (the API worker is up).
- [ ] `docker compose logs bootstrap` — shows `created admin@leenar.local`
      (or `already exists` on a re-run).
- [ ] Sign in at `http://localhost:8080` with the credentials `setup.sh`
      printed — lands in the console with no email-confirmation step.
- [ ] **(requires a real `OPENAI_API_KEY`)** In chat, ask for a simple service
      — a node should appear on the canvas.
- [ ] `curl -s -X POST http://localhost:8787/api/mcp -H "Authorization: Bearer
      lnr_..." -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,
      "method":"tools/list"}'` → a `result.tools` array of the canvas tools
      (make a token under Settings → API Tokens first).
- [ ] **(requires a real Vercel + GitHub PAT, and creates real cloud
      resources)** Connect GitHub and Vercel under Settings → Integrations,
      then Deploy a canvas that uses them — watch `docker compose logs -f api`
      for provisioning log lines, and confirm the project actually appears in
      your Vercel/GitHub accounts.

The last two steps need real credentials and (for the last one) will create
real cloud resources under your accounts — they're each a deliberate,
one-time manual check, not something to automate against a throwaway key.
