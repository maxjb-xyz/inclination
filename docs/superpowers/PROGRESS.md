# Build Progress Journal — Self-Hosted Notion

Single source of truth for build state. One entry per phase (and per significant mid-phase decision). See the runbook: [`build-orchestrator-instructions.md`](build-orchestrator-instructions.md) and the spec: [`specs/2026-06-05-self-hosted-notion-design.md`](specs/2026-06-05-self-hosted-notion-design.md).

## Phase Checklist

- [x] **Phase 0 — Foundation** — monorepo, Docker Compose, CI, `/health` + `/ready`
- [x] **Phase 1 — Auth & workspaces**
- [x] **Phase 2 — Page tree & single-user editor**
- [x] **Phase 3 — Real-time collaboration**
- [x] **Phase 4 — Full block editor**
- [x] **Phase 5 — Databases (collections)**
- [x] **Phase 6 — Comments, sharing & permissions**
- [x] **Phase 7 — Search, files & version history**
- [x] **Phase 8 — Publishing, import/export & synced blocks**
- [x] **Phase 9 — Polish & self-host hardening**

> **🎉 BUILD COMPLETE (2026-06-06):** all 10 phases shipped to `main`, tags `phase-0-complete` … `phase-9-complete`. `main` is green and deployable; a fresh clone → `scripts/setup-env.sh` → `docker compose up` yields a TLS-secured, real-time, multi-user Notion-style workspace. See the Success-Criteria check at the bottom of this file.

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

---

## Phase 6 — Comments, Sharing & Permissions

**Status:** ✅ complete (2026-06-06) — built via subagents (resolver/comments/sharing+web/e2e), orchestrator verified each gate.

**Plan:** [`plans/phase-6-comments-sharing-plan.md`](plans/phase-6-comments-sharing-plan.md)

**What was built**
- **Permission resolver (the crux):** upgraded the shared `resolvePageAccess` (used by BOTH API and sync) to spec §5 — nearest-ancestor explicit grant wins, else workspace-role default (owner/admin→full, member→edit, **guest→none, grant-only**), returning `{role, canRead, canComment, canWrite, canShare}`. Single `permission.findMany` over the ancestor chain; cycle-guarded. Wired `canWrite` into all page + database mutations and sync `readOnly` (closing the Phase-3 follow-up); `canComment` into comments; `canShare` into sharing.
- Models: `Permission`, `Comment`, `Notification` + migration.
- API: comments (page + inline-anchored, threads, reply, resolve, delete) with mention/reply → `Notification`s for users with access; notifications (list/unread-count/read/read-all); sharing (list/upsert/delete page grants, guest `share-invite` by email, `GET /pages/:id/access`).
- Web: share dialog, comments panel (threads, @-mention composer, resolve, inline anchors), notifications bell/inbox, and capability-aware UI (read-only editor when `!canWrite`).

**Gate evidence** ("guest sees only that subtree — at API AND sync; comments/@-mentions notify the right users")
- Lint + typecheck clean. Unit: resolver 21 + api + web 98 + db-engine 109. Integration (Testcontainers, run sequentially to avoid container contention): 8 files / 62 tests incl. comments + sharing. E2E (Playwright, `rtk proxy`): 12 total incl. phase6 — guest scoped at the **API** layer (200 on granted page + descendant, 403 on others, read-only) and the **sync** layer (real Hocuspocus provider: `page:B` rejected, `page:A` accepted), plus comment @-mention creates the guest's notification. Clean `docker compose up` healthy.

**Decisions / deviations**
- Guest-to-page invite = create a `guest` WorkspaceMember + a page `Permission` (subtree access via the resolver). New (no-account) invitees get a guest workspace invite and are re-shared on signup (no user-less grants).
- Integration suites now run sequentially (`fileParallelism:false`) — a fix for Testcontainers resource contention surfaced this phase.
- Adversarial review found no critical/material; resolver verified against all escalation vectors.

**Follow-ups (deferred — recorded for Phase 9 / a guest-scoping pass)**
- **Guest metadata scoping:** `listTree`/`searchMentionable`/`listMembers` gate on workspace membership, so a page-invited guest can enumerate all page titles/icons + member names/emails (not content). Filter these through `resolvePageAccess` for guest-role members.
- `share-invite` upserts a page grant even for an existing full-access admin — could *downgrade* them on that page if a weaker role is given (explicit beats default); skip the grant when the target already resolves ≥ requested role.
- Drop the unused `archivedAt` select in the resolver (or enforce an archived policy); optional realtime push for notifications.

**References**
- Branch `phase-6-comments-sharing` → merged to `main` (local), tag `phase-6-complete`.

---

## Phase 7 — Search, Files & Version History

**Status:** ✅ complete (2026-06-06) — built via subagents; T1 was interrupted by a session limit and finished by a continuation subagent; the adversarial review was done inline by the orchestrator (transient API 529s blocked subagent dispatch).

**Plan:** [`plans/phase-7-search-files-versions-plan.md`](plans/phase-7-search-files-versions-plan.md)

**What was built**
- **Search:** `SearchIndex` (Postgres `tsvector` via BEFORE-trigger + GIN index) maintained from the **sync server's Yjs→text extraction** on store + page title/cell text from the API. `GET /workspaces/:wsId/search?q=` — parameterized FTS (`websearch_to_tsquery`, `ts_rank`, `ts_headline` snippet with `[[ ]]` markers), workspace-scoped + membership-required, **per-row access-filtered** via the shared resolver.
- **Files:** `Attachment` model; `POST /workspaces/:wsId/uploads/presign` (membership + canWrite-when-paged; mime allowlist + 25 MiB cap; workspace-scoped uuid objectKey; path-safe filename) → presigned PUT; `GET /attachments/:id` → presigned GET, IDOR-safe. Presigned URLs signed against a **browser-reachable `S3_PUBLIC_ENDPOINT`** routed to MinIO through Caddy `/inclination/*` (SigV4 signs host+path; the internal `minio:9000` host is unreachable from the browser).
- **Version history:** `Snapshots` module — list/preview (Yjs→plaintext)/manual-create/restore; restore safety-snapshots the current state then replaces `PageContent.ydocState` (live clients pick it up on reload). Capability-gated, cross-page-`snapId`-safe.
- **Web:** ⌘K command palette over search (snippet highlights, nav, quick actions); editor image/file/video upload (presign→PUT→resolve, survives reload via stored `attachmentId` + fresh presigned URL); version-history panel (list/save/preview/restore, canWrite-gated).

**Gate evidence** ("search finds a typed phrase; uploaded image renders + survives reload; a prior version can be previewed and restored")
- Lint + typecheck clean. Unit: api 83 + web 116 + sync 20 + db-engine 109. Integration (Testcontainers Postgres + **real MinIO**, sequential): api 79 incl. 17 new (search access-filtering, presign + full PUT→GET byte round-trip, bad-mime/oversize 400, IDOR 403/404, snapshot create/restore). E2E (Playwright, real stack, `rtk proxy`): **15** total incl. phase7 — search via index+palette, image upload renders + survives reload (MinIO through Caddy), version preview + restore. Clean `docker compose up` healthy.

**Decisions / deviations**
- The MinIO presign-host fix (`S3_PUBLIC_ENDPOINT` + Caddy `/inclination/*`, no path rewrite) was required for the upload gate in the real stack — found by the e2e subagent.
- Snapshot preview returns plaintext (`decoded:false`); rich PM-JSON preview needs the editor schema (web-only) — deferred.
- Phase-7 review performed inline by the orchestrator (read search/files/snapshots services directly) due to API overload; same dimensions covered, no critical/material found.

**Follow-ups (deferred)**
- Search per-row `resolvePageAccess` loop (≤200) — cache/batch the resolver per request for large workspaces.
- Caddy `/inclination/*` hardcodes the default bucket name; parameterize if `MINIO_BUCKET` changes; consider rate-limiting the public object route (Phase 9).
- Live-restore (push restored state to connected clients without reload); richer snapshot preview; storage readiness probe could `HeadBucket` the real bucket.

**References**
- Branch `phase-7-search-files-versions` → merged to `main` (local), tag `phase-7-complete`.

---

## Phase 8 — Publishing, Import/Export & Synced Blocks

**Status:** ✅ complete (2026-06-06) — built via subagents (one T1 retry after a transient 529); orchestrator verified each gate.

**Plan:** [`plans/phase-8-publishing-import-synced-plan.md`](plans/phase-8-publishing-import-synced-plan.md)

**What was built**
- DB: `PublicShare` (slug, published, includeSubpages, allowDuplicate, publishedHtml/Title) + `SyncedBlock` (own Yjs doc) + migration.
- Publishing: publish/unpublish (canShare) storing a client-rendered HTML snapshot + unique slug; **unauthenticated `GET /api/public/:slug`** serving only published content (no leak; includeSubpages lists only published descendants).
- Import/Export: PM-JSON↔Markdown serializer/parser in `@inclination/editor`; `GET /pages/:id/export/markdown` (canRead) + `POST /workspaces/:wsId/import/markdown` (member, splits multi-H1 into a page tree). markdown-it with `html:false`.
- Synced blocks: API create/get + sync server serves `synced:{id}` Yjs docs (JWT + workspace-membership auth, persisted to `SyncedBlock.ydocState`); `page:{id}` unchanged.
- Web: publish dialog + **logged-out `/public/:slug` route** (rendered before the auth gate) with **DOMPurify** sanitization; markdown import (→ tree)/export (download); synced-block NodeView mounting a nested collaborative editor on `synced:{id}`.

**Gate evidence** ("publish → public URL viewable logged out; Markdown imports into a page tree; synced block edit propagates")
- Lint + typecheck clean. Unit: api 90 + web 139 + editor 42 + sync 29. Integration (Testcontainers): api 91 incl. publishing/import/synced + sync 5. E2E (Playwright, real stack, `rtk proxy`): **18** total incl. phase8 — published page viewable in a **fresh no-auth browser context**, multi-H1 import → sidebar tree, synced-block edit propagates across two contexts. Clean `docker compose up` healthy.

**Decisions / deviations**
- Publishing stores a client-rendered HTML snapshot (re-publish to refresh); live public pages = follow-up.
- Synced-block UI only mints new ids; cross-view propagation proven via two contexts on the same page (same `synced:{id}` doc).
- Adversarial review found **2 CRITICAL XSS bypasses** in the hand-rolled public-HTML sanitizer (SVG/MathML namespace confusion; unfiltered style/SMIL attrs). **Fixed by replacing it with DOMPurify** (allowlist tags/attrs, http/https/mailto only, style forbidden, svg/math dropped) + 14 XSS regression vectors; re-verified (e2e 18/18). A synced-block e2e flake (second-websocket timing) was fixed with timeout headroom.

**Follow-ups (deferred)**
- MF2: server-side sanitize `publishedHtml` at publish time (defense-in-depth) + a CSP header on the public route; live public pages; an "embed existing synced block id" affordance; Caddy already proxies `/public/*` via `/api/*`.

**References**
- Branch `phase-8-publishing-import-synced` → merged to `main` (local), tag `phase-8-complete`.

---

## Phase 9 — Polish & Self-Host Hardening

**Status:** ✅ complete (2026-06-06) — built via subagents (backend/infra/web/e2e), orchestrator verified each gate.

**Plan:** [`plans/phase-9-polish-hardening-plan.md`](plans/phase-9-polish-hardening-plan.md)

**What was built**
- **Favorites/recents:** `Favorite` + `RecentlyVisited` models + API (access-filtered, no IDOR); idempotent demo seed (`SEED_DEMO`).
- **Security pass** (closing all deferred follow-ups, verified correct by review): guest-role metadata scoping (`listTree`/`searchMentionable`/`members`), `share-invite` no-downgrade, **server-side** `publishedHtml` sanitize (`sanitize-html`, defense-in-depth atop client DOMPurify), and `@Throttle` on the remaining sensitive routes (oidc/verify-email/refresh/logout/reset-confirm/presign). Authz + validation audit clean.
- **Infra:** Caddy auto-TLS — `tls internal` (self-signed) for localhost, automatic ACME/Let's Encrypt for a real `APP_DOMAIN`; compose maps 443; `scripts/setup-env.{sh,ps1}` (strong-secret generation), `scripts/backup.sh` + `restore.sh` (pg_dump + MinIO `mc mirror`), top-level `README.md` self-hosting guide; migrations-on-boot confirmed.
- **Web polish:** dark mode (light/dark/system via CSS-variable tokens), responsive collapsible sidebar, keyboard shortcuts (⌘K/⌘\\/⌘⇧L/⌘N/?), sidebar Favorites + Recent sections + star/unstar + record-visit.

**Gate evidence** ("fresh clone → configure .env → docker compose up → working TLS-secured instance; backup + restore verified")
- Lint + typecheck clean. Unit: api 103 + web 163 + db-engine 109 + editor 42 + sync 29 + shared/db. Integration (Testcontainers): api 14 files incl. favorites + security-hardening. E2E (Playwright, **whole suite migrated to HTTPS/wss**, `rtk proxy`): **23 passed** + 1 gated — TLS health 200 over Caddy's internal CA, HTTP→HTTPS 308 redirect, dark-mode toggle, favorite-persists, and a **backup → `docker compose down -v` → restore → data-intact** verification (DB + MinIO mirror; 34 pages + a real uploaded image recovered).
- Clean `docker compose up` over HTTPS healthy.

**Decisions / deviations**
- Stack is now HTTPS-first; the e2e suite targets `https://localhost:8443` (self-signed → `ignoreHTTPSErrors`/`wss`).
- Adversarial review found no critical/material; confirmed the security-pass fixes are correct and earlier phases un-regressed.

**Follow-ups (deferred, cosmetic/optional)**
- Stale "5/min" comment in `e2e/playwright.config.ts` (register is now 20/min); orphan `Favorite`/`RecentlyVisited` rows (no FK — filtered at read); guest `searchMentionable` over-fetch cap; real-domain deploy must override `S3_PUBLIC_ENDPOINT`/`APP_BASE_URL`/`CORS_ORIGIN` (README documents this); HTTP→HTTPS redirect drops the `:8443` host-port locally.

**References**
- Branch `phase-9-polish-hardening` → merged to `main` (local), tag `phase-9-complete`.

---

## ✅ Success Criteria (spec §10) — verified end to end

A fresh clone → configure `.env` → `docker compose up` produces a TLS-secured, multi-user, real-time Notion-like workspace where a team can:
- ✅ write collaborative documents with the full block set, live cursors, and offline-then-sync — Phases 2/3/4 (e2e: two-context merge + cursors + offline reconnect; full slash-menu block set round-trips).
- ✅ run relational task/project databases across table, board, calendar, gallery with filters/sorts/grouping/relations/rollups/formulas/sub-items/dependencies — Phase 5 (e2e: board-by-status, calendar/filtered, rollup=150, formula, sub-item, live cell broadcast).
- ✅ embed inline & linked databases and synced blocks — Phases 5/8 (inline `databaseView` node; synced block propagation across contexts).
- ✅ comment (page + inline), mention, and get notified — Phase 6.
- ✅ share/permission pages with inheritance, invite guests, publish public read-only pages — Phases 6/8 (guest scoped at API **and** sync; logged-out `/public/:slug`).
- ✅ search, upload files/images, restore prior versions — Phase 7 (full-text via tsvector; MinIO presigned upload survives reload; snapshot restore).
- ✅ import from / export to Markdown — Phase 8.
- ✅ all self-hosted, single `docker compose up`, TLS, backups + restore, no external SaaS dependency — Phases 0/9.
