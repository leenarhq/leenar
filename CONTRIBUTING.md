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
  Before opening a PR, run `npm run lint`, `npx tsc --noEmit` in both `apps/web`
  and `workers/api`, and `npm run build` in `apps/web`. (The web console has a
  small Vitest suite; the API worker's test suite is not part of this core
  release.)
