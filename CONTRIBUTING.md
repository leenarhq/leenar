# Contributing to Leenar Core

Thanks for your interest! Leenar Core is developed upstream in a private
monorepo and mirrored here; maintainers back-port accepted community changes.

- **Issues:** bug reports and feature requests welcome via GitHub Issues.
- **Pull requests:** keep them focused; include a clear description and, where
  practical, a test. By submitting a PR you agree to license your contribution
  under AGPL-3.0-only.
- **Scope:** this repo is the interactive core. Always-on autonomy features
  live in Leenar Cloud and are out of scope here.
- **Dev:** `npm install`, then `workers/api` (wrangler) and `apps/web` (vite).
  Before opening a PR, run `npm run lint`, `npx tsc --noEmit` and `npm test` in
  both `apps/web` and `workers/api`, and `npm run build` in `apps/web`. CI runs
  the same commands.
- **Tests:** both workspaces ship Vitest suites and CI runs them. The worker
  suite is the subset of the upstream one that depends only on modules this
  repo ships — a handful of upstream tests assert Leenar Cloud behaviour of a
  shared module (rate limiting, for one) and would fail here, so they are not
  included. `apps/web`'s tests need `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` set to any non-empty value; nothing in the suite
  makes a network call.
