# Contributing to Leenar Core

Thanks for your interest.

## How this repository works

Leenar Core is developed upstream in a private monorepo and synced here
automatically whenever that monorepo's `main` branch moves. Every commit on this
repo's `main` was produced by that sync.

Pull requests are welcome and are merged **here**. A maintainer then back-ports
the change upstream. Until that happens the sync pauses rather than publishing
over your commit, so a merged contribution is never silently reverted — it may
just take a few days to appear in a release.

## Before you open a pull request

**Sign the CLA.** A bot will ask on your first pull request. Leenar Core is
AGPL-3.0-only and is built from the same source tree as the commercial Leenar
Cloud, so we need a relicensing grant before a contribution can be merged. The
text is in [CLA.md](CLA.md).

**Check the scope.** This repo is the interactive core: chat, canvas,
provisioning, self-hosting. Always-on autonomy — autopilot, incident response,
drift reconciliation, cost tracking, alerting — lives in Leenar Cloud and is out
of scope here.

**Run the checks.** CI runs exactly these:

```bash
npm ci
cd apps/web    && npm run lint && npx tsc --noEmit && npm test && npm run build
cd workers/api && npx tsc --noEmit && npm test
```

`apps/web`'s tests need `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set to
any non-empty value; nothing in the suite makes a network call.

## Issues

Bug reports and feature requests are welcome. If you are not sure whether
something is a bug or a scope question, open an issue before writing code.

## Tests

Both workspaces ship Vitest suites and CI runs them. The worker suite is the
subset of the upstream one that depends only on modules this repo ships — a few
upstream tests assert Leenar Cloud behaviour of a shared module (rate limiting,
for one) and would fail here, so they are not included.
