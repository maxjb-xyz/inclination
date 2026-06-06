# Phase 9 — Polish & Self-Host Hardening Plan

**Goal:** Dark mode, responsive layout, keyboard shortcuts, favorites/recents, quick nav. Compose finalization (Caddy auto-TLS, `.env` config, volume backups + restore), migrations on boot, seed/demo data, security pass (rate limits, validation, authz audit), self-hosting guide.

**Gate (spec §8):** a fresh `git clone` → configure `.env` → `docker compose up` yields a working, TLS-secured instance per the README; backup + restore verified.

## Backend + data (apps/api, packages/db)
- **Favorites / recents** (spec §5): `Favorite` { userId, pageId, order, @@id([userId,pageId]) }, `RecentlyVisited` { userId, pageId, visitedAt, @@id([userId,pageId]) }. Migration `favorites_recents`. API: list/add/remove/reorder favorites; record-visit + list recents; all access-gated (resolvePageAccess). Visit recorded on GET page (or an explicit endpoint).
- **Seed/demo data**: `packages/db` seed script (`prisma db seed` or a node script) creating a demo workspace + a couple of pages + a sample "Tasks" database, idempotent; documented opt-in (`SEED_DEMO=true`).
- **Security pass — close the accumulated follow-ups:**
  - Guest metadata scoping: filter `listTree`/`searchMentionable`/`listMembers` for guest-role members through resolvePageAccess (a guest sees only granted subtrees + can't enumerate all members) — Phase 6 follow-up.
  - `share-invite` must not downgrade an existing higher-access member (skip the grant when the target already resolves ≥ requested role) — Phase 6 follow-up.
  - Server-side sanitize `publishedHtml` at publish time (defense-in-depth) — Phase 8 follow-up.
  - Throttle the still-unthrottled sensitive routes (oidc, verify-email, refresh, password-reset/confirm, uploads/presign) — Phase 1/4 follow-up.
  - Authz audit: a quick sweep confirming every mutation route goes through the resolver/membership (document findings).
  - Validation audit: confirm Zod at every edge.
- Integration tests for favorites/recents + the security fixes (guest can't enumerate; share-invite no-downgrade; published html sanitized server-side).

## Infra (Caddy auto-TLS, .env, backups, boot)
- **Caddyfile auto-TLS:** parameterize by `APP_DOMAIN`. When `APP_DOMAIN` is a real domain → Caddy automatic HTTPS (Let's Encrypt). For local/gate → `tls internal` (self-signed) so HTTPS works on `localhost`. Keep `/api`, `/collab`, `/sync`, `/public`, `/inclination` (MinIO) routes. Use a Caddyfile that switches on the domain (env-substituted site address + `tls internal` when localhost). Map 443 (and 80→443 redirect) in compose; keep `CADDY_HTTP_PORT`/`CADDY_HTTPS_PORT`.
- **Migrations on boot:** already done (the one-shot `migrate` service) — confirm + document.
- **Secrets setup:** a `scripts/setup-env.sh` (and a `.ps1` for Windows) that copies `.env.example`→`.env` and generates strong `JWT_ACCESS_SECRET` + DB/MinIO passwords (the production guard requires a strong secret). README references it. So "configure `.env`" = run the setup script (or edit manually).
- **Backups + restore:** `scripts/backup.sh` (pg_dump the Postgres volume + `mc mirror` the MinIO bucket to a timestamped `backups/` dir) and `scripts/restore.sh` (restore a chosen backup: psql restore + mc mirror back). A documented nightly cron suggestion. Make them runnable against the compose stack.
- **Self-hosting guide:** a top-level `README.md` — prerequisites, `setup-env`, `docker compose up`, accessing over HTTPS, configuring `APP_DOMAIN` + OIDC + SMTP, backup/restore, upgrading. Plus the success criteria.

## Web polish (apps/web)
- **Dark mode**: theme (light/dark/system) toggle persisted; CSS variables for both themes across the app.
- **Responsive layout**: collapsible sidebar on narrow viewports; usable on mobile widths.
- **Keyboard shortcuts**: ⌘K (exists), plus e.g. ⌘\\ toggle sidebar, ⌘⇧D dark mode, navigation; a small shortcuts help. 
- **Favorites/recents**: a sidebar "Favorites" + "Recent" section backed by the API; star/unstar a page; recents update on visit.
- **Quick nav**: ⌘K already covers switching; ensure favorites/recents surface there too.
- Unit tests for the new UI logic (theme store, favorites hooks, shortcut handlers).

## Tests
- Unit: theme/favorites/shortcuts (web); backup/restore script smoke (where feasible); security-fix units (guest filter, share-invite no-downgrade, publish sanitize).
- Integration (Testcontainers): favorites/recents endpoints + access gating; the security fixes; seed script runs.
- E2E (Playwright): the GATE — bring the stack up with **HTTPS (Caddy tls internal)**, verify the app loads over `https://localhost` (accept self-signed); **backup → wipe → restore → data intact** (create a page, run backup script, `docker compose down -v`, restore script, `up`, assert the page is back); plus dark-mode toggle + favorite-a-page smoke.

## Tasks (subagent-driven)
- **T1 backend/security**: Favorite/RecentlyVisited models + API + migration; seed script; the security-pass fixes (guest scoping, share-invite no-downgrade, server-side publish sanitize, throttle sensitive routes) + authz/validation audit notes; integration tests.
- **T2 infra**: Caddy auto-TLS (APP_DOMAIN, tls internal for localhost) + compose 443; `setup-env` + `backup`/`restore` scripts; README self-hosting guide; verify migrations-on-boot.
- **T3 web polish**: dark mode, responsive, shortcuts, favorites/recents UI; unit tests.
- **T4 e2e + gate**: HTTPS boot + backup/restore-verified + polish smoke; full DoD; final success-criteria check.

## Out of scope
Anything in spec "Out of scope (v1)" (native mobile, templates, SAML, AI, web clipper, horizontal scaling).
