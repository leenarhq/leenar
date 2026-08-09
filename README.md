# Leenar (Core)

Chat → canvas → deploy. Describe your cloud infrastructure in natural language,
watch it become an editable graph of services, and provision it in one click.

This is the **open-source core** of [Leenar](https://leenar.net), licensed under
**AGPLv3**. It includes the interactive AI (chat → canvas), the provisioning
engine, connectors (GitHub, Vercel, Supabase, Resend, Cloudflare), the database
workspace, and the console UI. Bring your own OpenAI API key — no usage caps.

## What's here vs. Leenar Cloud

The core gives you the full interactive build-and-deploy loop, self-hosted.
**Leenar Cloud** adds always-on autonomy — the AI DevOps engineer that watches
your stack 24/7: incident monitoring, drift auto-reconcile, autopilot,
Slack/WhatsApp channels, and cost/observability insight. → https://leenar.net

## Quick start

The fastest way to try Leenar is Docker — no Supabase project, no OAuth apps,
just Docker and an OpenAI API key:

```bash
bash docker/setup.sh   # writes .env, fills random secrets
$EDITOR .env            # set OPENAI_API_KEY=sk-...
docker compose up       # add -d to run in the background
```

Open <http://localhost:8080> and sign up. See [SELF-HOST.md](./SELF-HOST.md)
for the full guide — including connecting GitHub/Vercel/Cloudflare/Supabase
via pasted Personal Access Tokens, and production-hardening notes before you
expose the stack beyond `localhost`.

### Local development (without Docker)

```bash
npm install
# Worker (API): cd workers/api && npx wrangler dev
# Web (console): cd apps/web && npm run dev
```

This needs your own Supabase project (run `supabase/migrations` against it)
and worker secrets set manually — see `workers/api/src/types.ts` (the `Env`
interface) for the full var list.

## License

[AGPL-3.0-only](./LICENSE). Network use is distribution — self-hosted
modifications must be shared under the same license.
