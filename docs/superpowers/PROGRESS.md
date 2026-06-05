# Build Progress Journal — Self-Hosted Notion

Single source of truth for build state. One entry per phase (and per significant mid-phase decision). See the runbook: [`build-orchestrator-instructions.md`](build-orchestrator-instructions.md) and the spec: [`specs/2026-06-05-self-hosted-notion-design.md`](specs/2026-06-05-self-hosted-notion-design.md).

## Phase Checklist

- [x] **Phase 0 — Foundation** — monorepo, Docker Compose, CI, `/health` + `/ready`
- [ ] **Phase 1 — Auth & workspaces**
- [ ] **Phase 2 — Page tree & single-user editor**
- [ ] **Phase 3 — Real-time collaboration**
- [ ] **Phase 4 — Full block editor**
- [ ] **Phase 5 — Databases (collections)**
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
