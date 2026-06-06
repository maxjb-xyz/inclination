# Build Progress Journal — Self-Hosted Notion

Single source of truth for build state. One entry per phase (and per significant mid-phase decision). See the runbook: [`build-orchestrator-instructions.md`](build-orchestrator-instructions.md) and the spec: [`specs/2026-06-05-self-hosted-notion-design.md`](specs/2026-06-05-self-hosted-notion-design.md).

## Phase Checklist

- [x] **Phase 0 — Foundation** — monorepo, Docker Compose, CI, `/health` + `/ready`
- [x] **Phase 1 — Auth & workspaces**
- [x] **Phase 2 — Page tree & single-user editor**
- [x] **Phase 3 — Real-time collaboration**
- [x] **Phase 4 — Full block editor**
- [x] **Phase 5 — Databases (collections)**
- [ ] **Phase 6 — Comments, sharing & permissions**
- [ ] **Phase 7 — Search, files & version history**
- [ ] **Phase 8 — Publishing, import/export & synced blocks**
- [ ] **Phase 9 — Polish & self-host hardening**

## Environment (verified 2026-06-05)

- OS: Windows 11 Pro, PowerShell + Bash available.
- Node v25.2.0, npm 11.6.2, pnpm 11.5.2.
- Docker 29.0.1, Docker Compose v2.40.3, daemon running.
- git 2.51.2; remote `origin` → `github-xyz:maxjb-xyz/inclination`.

---

## Phase 0 — Foundation

**Status:** ✅ complete (2026-06-05)

**What was built**
- pnpm-workspaces monorepo: `apps/{web,api,sync}`, `packages/{db,shared,editor}`, `e2e/`.
- Tooling: TypeScript (strict) base config, flat ESLint + Prettier, `.env.example`, `.gitattributes` (LF normalization).
- `packages/shared`: health contract (`serviceHealth`, `livenessReport`), typed env reader, role/page/permission constants.
- `packages/db`: Prisma + Postgres, baseline `HealthCheck` model, `0_init` migration, `PrismaClient` singleton.
- `packages/editor`: stub (real Tiptap extensions land Phase 4).
- `apps/api` (NestJS): `/api/health` (liveness) + `/api/ready` (readiness aggregating Postgres + MinIO probes; true 503 on failure).
- `apps/sync` (Hocuspocus + `ws`): `/health` + `/ready` over HTTP, `/collab` websocket upgrade; DB readiness probe.
- `apps/web` (Vite + React 19): SPA shell with a live API-health indicator.
- Infra: `node.Dockerfile` (api+sync), `web.Dockerfile` (Vite build served by Caddy), Caddyfile (`/api`, `/collab`, `/sync` health, SPA fallback), `docker-compose.yml` (postgres healthcheck, minio, bucket bootstrap, one-shot prisma migrate, api/sync healthchecks, caddy entrypoint, named volumes).
- CI (`.github/workflows/ci.yml`): lint/typecheck/unit · Testcontainers integration · docker-compose e2e gate.
- Tests: 12 unit (Vitest), 2 integration (Testcontainers real Postgres+MinIO), 3 e2e (Playwright through Caddy). `scripts/phase0-gate.sh` reproducible clean-boot gate.

**Gate evidence (Done when: `docker compose up` healthy + `/health`+`/ready` pass for API & sync)**
- Clean-boot gate (wipe volumes → build → up → assert → teardown) PASSED: `/api/health` 200, `/api/ready` 200 (postgres+minio up), `/sync/health` 200, `/sync/ready` 200 (postgres up), `/` 200.
- Lint clean · typecheck clean (self-contained) · unit 12/12 · integration 2/2 · e2e 3/3.

**Decisions (under ambiguity)**
- Module strategy: internal packages compile to CommonJS `dist`; **api** stays CJS (NestJS); **sync** is ESM (Hocuspocus/Yjs are ESM-only); **web** ESM (Vite). ESM-importing-CJS is supported.
- Single `node.Dockerfile` for api+sync (command override) instead of the plan's separate `api.Dockerfile`/`sync.Dockerfile`; only `api` builds the shared `inclination-node` tag to avoid a concurrent same-tag export race; `migrate`/`sync` reuse it.
- Vitest/Vite resolve `@inclination/*` to **source** (alias) for fast inner loop; runtime/build use built `dist`. Root `typecheck` builds packages first so it's self-contained.
- Health implemented manually (probe interface) rather than `@nestjs/terminus` — fewer deps, fully unit-testable with fakes.
- Sync health exposed via Caddy `handle_path /sync/*` so the e2e gate can reach it through the single entrypoint.

**Deviations from spec**
- None material. Stack and data-model names follow the spec. Search/Meilisearch, real auth, etc. are later phases.

**Follow-ups (deferred, recorded for later phases)**
- Phase 9 hardening: prune runtime images to production install + `dist` only (currently ship full dev toolchain); set explicit Prisma `binaryTargets` (`debian-openssl-3.0.x`) to silence the libssl detection warning; restrict/secure the public `/sync/*` health route; require all secrets via env (remove dev fallback creds in `storage.service.ts`).
- Phase 7: storage readiness probe could `HeadBucket` the real bucket instead of `ListBuckets`.
- Reviewer finding "`allowBuilds` is invalid pnpm config" verified as a **false positive** — pnpm 11.5.2 generates and honors the `allowBuilds` map (swc native binding + prisma engine present; no "ignored build scripts" warning).

**References**
- Plan: [`plans/phase-0-foundation-plan.md`](plans/phase-0-foundation-plan.md)
- Branch `phase-0-foundation` → merged to `main` (local), tag `phase-0-complete`.
- Commits: scaffold, infra/CI/e2e, review fixes, journal.

---

## Phase 1 — Auth & Workspaces

**Status:** ✅ complete (2026-06-05)

**Plan:** [`plans/phase-1-auth-workspaces-plan.md`](plans/phase-1-auth-workspaces-plan.md)

**What was built**
- Data model (spec §5): `User`, `Workspace`, `WorkspaceMember`, `Invitation`, `RefreshToken`, `EmailVerificationToken`, `PasswordResetToken`, `WorkspaceRole` enum; migration `20260605231634_auth_workspaces`.
- Shared: Zod schemas for all auth/workspace requests.
- API (NestJS): `PasswordService` (argon2id); `TokenService` (access JWT + DB-backed rotating refresh, reuse-detection revokes the whole chain); `AuthService`/`AuthController` (register + email verification, login gated on verification, refresh, logout, password reset that doesn't leak existence + revokes sessions, `/auth/me`); JWT passport guard + `@CurrentUser`; throttled auth routes; CORS locked. OIDC (`OidcService`/`OidcController`): discovery, browser-bound state+nonce (HttpOnly cookie), code exchange, RS256 id_token verification via JWKS, `email_verified`-gated user upsert/link, redirect-to-SPA. Users profile (`GET/PATCH /users/me`). Workspaces (create→owner, list/get/update/members) + Invitations (invite owner/admin-only, email-matched accept, list pending) with membership/role guards.
- Mail: transport-agnostic `MailService` (SMTP via nodemailer; in-memory `CapturingTransport` for dev/tests).
- Web: auth client, persisted Zustand session store, login/register forms + signed-in view.
- Production secret guard: API refuses to boot with `NODE_ENV=production` and an empty/known-weak `JWT_ACCESS_SECRET`.

**Gate evidence** ("register → verify → create workspace → invite member → both log in; OIDC against a test provider")
- Lint + typecheck clean. Unit: 12 shared + 22 api + 3 sync + 3 web. Integration (Testcontainers Postgres + in-process **mock OIDC** with real RS256/JWKS): 8 — full register→verify→login→refresh-rotate(+reuse-reject)→workspace→invite→accept and OIDC (incl. no-cookie→401 CSRF check). E2E (Playwright through Caddy + Mailpit overlay): 4 — phase-0 health + the phase-1 register→verify→login→workspace→invite→accept flow.
- Clean `docker compose up` (with secret guard active, NODE_ENV=production) boots all services healthy.

**Decisions / deviations**
- OIDC implemented with `jsonwebtoken` + `jwks-rsa` (not the plan's `openid-client`) to stay CJS-friendly in the Nest app; full discovery + JWKS signature + iss/aud/nonce verification retained.
- OIDC covered rigorously at the **integration layer** (real signature verification against the mock issuer); e2e (compose) covers the email/password + workspace + invite flow. Rationale: OIDC needs an external provider; an in-process mock is the right test seam, and a dockerized IdP in compose was out of proportion for the gate.
- Mail uses an in-memory capture transport for tests; a `docker-compose.e2e.yml` overlay adds Mailpit so the e2e reads real verification/invite emails (prod compose stays clean).
- Adversarial review found 2 CRITICAL (OIDC state CSRF; weak default JWT secret) + 2 MATERIAL (email_verified linking; JSON-on-navigation); all fixed and re-verified by an independent reviewer before merge.

**Follow-ups (deferred to Phase 9 hardening)**
- Throttle OIDC routes; use a one-time handoff code instead of token-in-fragment; separate signing key for the OIDC tx cookie; constant-time/throttled token lookups; reduce password-reset timing oracle; HttpOnly-cookie refresh option; quick-start that generates secrets so `cp .env.example .env && docker compose up` works without manual secret-gen.

**References**
- Branch `phase-1-auth-workspaces` → merged to `main` (local), tag `phase-1-complete`.

---

## Phase 2 — Page Tree & Single-User Editor

**Status:** ✅ complete (2026-06-06) — built via subagents (orchestrator verified each).

**Plan:** [`plans/phase-2-page-tree-editor-plan.md`](plans/phase-2-page-tree-editor-plan.md)

**What was built**
- Data model: `Page` (self-ref tree, `sortKey` fractional index, `archivedAt`, icon/cover, type) + `PageContent` (interim Tiptap JSON `doc`; Phase 3 migrates to Yjs `ydocState`), `PageType` enum; `pages` migration.
- API (`apps/api/src/pages`): create, list-tree, get+breadcrumbs, patch, **move** (reorder + reparent via fractional-indexing, cycle-guarded, cross-workspace-rejected), soft-delete cascading `archivedAt` to descendants, restore (un-archives ancestors too), trash list, content get/put. Every endpoint under `JwtAuthGuard` + workspace-membership authz (reusing `WorkspacesService.requireMember`); page-scoped routes check the page's own workspace (no IDOR).
- Web (`apps/web`): authenticated `apiClient` (Bearer + single-flight 401 refresh-and-retry), TanStack Query layer, workspace bootstrap, collapsible dnd-kit page tree (reorder + reparent), breadcrumbs, Tiptap StarterKit editor with page-bound debounced autosave + content load, trash/restore, icon/cover editing.

**Gate evidence** ("create / nest / move / trash / restore; text edits persist across reload")
- Lint + typecheck clean. Unit: shared 22 + api 30 + sync 3 + web 23. Integration (Testcontainers): 17 total (incl. 9 pages: nest/move/cycle-reject/trash-restore/content round-trip/non-member 403). E2E (Playwright, real stack): 6 — incl. phase-2 PART A (REST tree ops + content round-trip) and PART B (type in real editor → reload → text persists). Clean `docker compose up` healthy with the new migration (verified the `fractional-indexing` ESM dep runs under the CJS Node 22 container).

**Decisions / deviations**
- `PageContent.doc` stores Tiptap JSON in Phase 2 (no live collab yet); Phase 3 migrates to Yjs `ydocState` (documented in schema + plan).
- Built by dispatching subagents (backend T1, web T2, e2e T3) with the orchestrator independently verifying every gate — keeps context clean per the user's directive.
- Adversarial review found 2 MATERIAL client bugs — **M2** concurrent-refresh force-logout and **M1** autosave-writes-wrong-page — both fixed with regression tests and re-verified (e2e green) before merge.

**Follow-ups (deferred)**
- Restore currently un-archives the whole subtree including independently-trashed descendants (consider archive-timestamp batching); `move` doesn't reject an archived target parent; editor act() warning in tests; code-split Tiptap bundle.

**References**
- Branch `phase-2-page-tree-editor` → merged to `main` (local), tag `phase-2-complete`.

---

## Phase 3 — Real-Time Collaboration

**Status:** ✅ complete (2026-06-06) — built via subagents (backend/web/e2e), orchestrator verified each gate.

**Plan:** [`plans/phase-3-realtime-collab-plan.md`](plans/phase-3-realtime-collab-plan.md)

**What was built**
- DB: `PageContent.ydocState` (Yjs binary) + `PageSnapshot` model + migration; shared `resolvePageAccess(prisma,userId,pageId)` in `packages/db` used by BOTH API and sync (spec §9 invariant).
- Sync (`apps/sync`): real Hocuspocus + `@hocuspocus/extension-database` persisting Yjs updates to `ydocState`; `onAuthenticate` verifies the JWT signature, parses `page:{id}`, enforces per-page access via the shared resolver, sets `connection.readOnly` when `!canWrite`; throttled `PageSnapshot` groundwork (failure-isolated); production secret guard.
- Web: collaborative Tiptap editor over `Y.Doc` + `HocuspocusProvider` (token-auth at `/collab`, doc `page:{id}`) + `y-indexeddb` offline + `Collaboration`/`CollaborationCursor` for merged edits and live remote carets; presence/connection indicator; per-page session lifecycle; dropped REST body autosave.

**Gate evidence** ("two browsers edit simultaneously with merged edits + live cursors; offline edits sync on reconnect")
- Lint + typecheck clean. Unit: shared 22 + db + api 30 + sync 20 + web (9 files). Integration (Testcontainers): sync persistence/auth 4 + api 17. E2E (Playwright, **two browser contexts** through the real stack): 7 total incl. phase3-collab — bidirectional merged edits, visible remote caret, and offline-partition→reconnect convergence (non-tautological; verified via `rtk proxy` to bypass cached output). Clean `docker compose up` healthy.

**Decisions / deviations**
- Phase-2 `PageContent.doc` JSON not migrated into Yjs (greenfield, no prod data); collab docs start fresh.
- `@hocuspocus/*` pinned to v2.15.x (matches server) — v3/v4 are type-incompatible.
- **Critical bug caught by the e2e gate:** `docker-compose.yml` didn't pass `JWT_ACCESS_SECRET` to the sync service → sync used the dev default while the API signed with the real secret → every collab connection rejected. Fixed in compose; added a sync production secret guard so this fails fast. (This is the core value of gating through the real stack.)
- Raised register throttle 5→20/min (5/min blocked shared-NAT signups and flaked the serial e2e).
- Independent review found no critical/material issues.

**Follow-ups (deferred)**
- **Phase 6:** API write endpoints (`pages.saveContent`/`update`) currently gate on access existence, not `access.canWrite` — tighten to honor read-only roles when Permission grants land (sync already honors `canWrite`). Add a regression test then.
- Archived-page access policy (`resolvePageAccess` selects `archivedAt` but doesn't enforce); token-refresh on live ws reconnect; gate the UI "Connected" indicator on a successful authenticated/synced event.

**References**
- Branch `phase-3-realtime-collab` → merged to `main` (local), tag `phase-3-complete`.

---

## Phase 4 — Full Block Editor

**Status:** ✅ complete (2026-06-06) — built via subagents (backend/editor/web/e2e), orchestrator verified each gate.

**Plan:** [`plans/phase-4-full-block-editor-plan.md`](plans/phase-4-full-block-editor-plan.md)

**What was built**
- API: `PageReference` model + migration; `PUT /pages/:id/references` (transactional set-replace, self/cross-workspace filtered), `GET /pages/:id/backlinks` (excludes archived), `GET /workspaces/:wsId/search/mentionable` (members + pages). Authz via shared resolver + requireMember.
- `packages/editor` (now real): `buildBlockExtensions` for the full §7 block set (paragraph, H1–H3, bullet/ordered/toggle/task lists, quote, callout, divider, columns, TOC, code+lowlight, inline code, KaTeX equation, URL-based image/file/video/bookmark/embed, table, `pageLink`+`mention` nodes), markdown input rules, `slashMenuItems` registry, `extractPageReferences`, and an http(s)-only `safeUrl` guard. Collaboration-safe (no history).
- Web: slash menu + custom drag handle/block menu (duplicate/delete/turn-into/move); `@`-mention + `[[` page-link suggestions calling mentionable search; mention/pageLink React NodeViews with live titles + click-to-navigate; debounced reference-sync; backlinks panel.

**Gate evidence** ("every block inserts via slash menu + round-trips reload/collab; page mention creates a working backlink")
- Lint + typecheck clean. Unit: editor 26 + web 56 + api 38 + shared + db. Integration (Testcontainers): references 6 (+ regression 23 api total). E2E (Playwright, real stack, verified via `rtk proxy`): 9 total incl. phase4 — slash-menu inserts heading/list/todo/quote/callout/divider/code and they survive reload, and `[[`→target page's backlinks panel lists the source. Clean `docker compose up` healthy.

**Decisions / deviations**
- Media blocks are URL-based in Phase 4 (upload via MinIO is Phase 7); inline/linked databases → Phase 5; synced blocks → Phase 8.
- `@hocuspocus`/Tiptap kept on v2; editor consumed by web via source-alias (runtime) + dist types (typecheck), so `web.Dockerfile` now builds all packages before web.
- Adversarial review found a **CRITICAL stored XSS** (media/embed/file/bookmark rendered `javascript:`/`data:` URLs into href/iframe-src → token exfiltration syncing to all collaborators). Fixed with an http(s)-only allowlist at commit + render + serialization, with unit tests; re-verified (e2e 9/9). Also fixed a latent stale-workspace-id (M2) in the editor.

**Follow-ups (deferred)**
- Round-trip unit tests for the keyboard-skipped media/equation/table/columns/toc nodes (e2e covers structural blocks); CSP + iframe `sandbox` for embeds (defense beyond scheme filtering); one-time scrub of any pre-existing unsafe `src` in stored docs; order-insensitive reference-sync comparison (M3).

**References**
- Branch `phase-4-full-block-editor` → merged to `main` (local), tag `phase-4-complete`.

---

## Phase 5 — Databases (Collections)

**Status:** ✅ complete (2026-06-06) — the largest phase; built via 6 subagents (model/engines/API/realtime/web/e2e), orchestrator verified each gate.

**Plan:** [`plans/phase-5-databases-plan.md`](plans/phase-5-databases-plan.md)

**What was built**
- DB: `Database/Property/Cell/RelationLink/View` models + `databases` migration (rows are `Page`s of type `row`).
- `@inclination/db-engine` (new pure package): per-type cell value validation, AND/OR filter eval, multi-key sort, grouping, all rollup aggregations, and a formula parser+evaluator (bounded fns, errors-as-values, depth-guarded). 109 unit tests.
- API (`apps/api/src/databases`): databases/properties/views/rows/cells/relations CRUD; two-way relation mirror (transactional); per-request computed values (relation/rollup/formula, cycle-guarded); `POST /databases/:id/query` pipeline (filter→sort→group→cursor-paginate) returning cells + computed + groups. All authz via the shared resolver (no IDOR).
- Realtime: socket.io gateway at `/api/realtime` (JWT-handshake auth, per-database room authorized by the shared resolver) bound to `DatabaseEventsService`, broadcasting every mutation (LWW per cell) — the structured-data mechanism (relational + broadcast, NOT Yjs, per §4/§6).
- Web (`apps/web/src/databases`): dbApi + realtime client (per-db rooms, self-echo suppression, cache patch); `DatabaseView` with Table/Board(dnd)/Calendar/Gallery, per-type cell editors, filter/sort/group/visible-props controls, property/select/relation/rollup/formula config; inline `databaseView` editor node + slash action; optimistic cell edits.

**Gate evidence** ("Tasks board-by-status + calendar-by-due + filtered table; rollup over linked Projects; a formula; a sub-task; edits propagate live to a 2nd browser")
- Lint + typecheck clean. Unit: db-engine 109 + api 73 + web 82 + shared + db. Integration (Testcontainers, real Postgres + real socket client): databases 13 + realtime 3 (+ full api suite 38). E2E (Playwright, real stack, verified via `rtk proxy`): 11 total incl. phase5 PART A (board groups, filtered/calendar rows, rollup=150/100/0, formula values, sub-item nesting — all via the API engine end-to-end) and PART B (a real inline cell edit by user A propagates live to user B's browser over the socket).
- Clean `docker compose up` healthy (socket.io proxied via Caddy `/api/*`).

**Decisions / deviations**
- Structured data is relational + LWW broadcast (not Yjs); realtime suppresses a client's own echoes (optimistic), so cross-browser propagation is proven with two distinct users.
- Engines isolated in `@inclination/db-engine` for reuse + deterministic unit testing (time injected).
- Query loads a database's rows in-memory per request then filters/sorts/groups/paginates (fine for v1; flagged for the scale/index pass).
- Adversarial review found no critical; one MATERIAL (query 500→400 on a type-mismatched filter operator) fixed with error-translation + a formula parser depth guard, with tests.

**Follow-ups (deferred)**
- Validate filter-operator-vs-property-type at the schema edge (precise field errors); virtualize large table views + bound the per-query in-memory row load (scale); cross-workspace relations expose linked row-ids (metadata) to target-only members — revisit with Phase 6 permissions; gallery/date config richer handling.

**References**
- Branch `phase-5-databases` → merged to `main` (local), tag `phase-5-complete`.
