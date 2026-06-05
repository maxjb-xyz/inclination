# Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the pnpm monorepo skeleton (web, api, sync, db, shared, editor), wire Prisma+Postgres, MinIO, Caddy, and Docker Compose, plus a CI pipeline, so that `docker compose up` boots all services healthy and `/health` + `/ready` pass for API and sync.

**Architecture:** pnpm-workspaces TypeScript monorepo. NestJS API exposes liveness (`/health`) and readiness (`/ready`, checks Postgres + MinIO). A Hocuspocus-based sync app exposes the same health endpoints over a plain HTTP server alongside the (not-yet-used) websocket server. A Vite React SPA builds to static assets. Caddy reverse-proxies `/` → web, `/api/*` → api, `/collab` → sync. Compose orchestrates postgres, minio, api, sync, web-build, caddy with healthchecks and ordered startup. Prisma migrations run on boot.

**Tech Stack:** pnpm, TypeScript, ESLint+Prettier, NestJS, @hocuspocus/server, React+Vite, Prisma+PostgreSQL, MinIO (S3), Caddy, Vitest + Testcontainers, GitHub Actions.

---

## Phase scope (from spec §8) — acceptance target

> **Phase 0 — Foundation:** pnpm monorepo (`apps/web`, `apps/api`, `apps/sync`, `packages/db|shared|editor`), TypeScript/ESLint/Prettier, Prisma + Postgres, MinIO, Caddy, Docker Compose skeleton, CI pipeline (lint + typecheck + test).
> **Done when:** `docker compose up` boots all services healthy and `/health` + `/ready` pass for API and sync.

Definition of Done (spec §9) applies: lint+typecheck clean → unit/integration/e2e green → phase e2e gate passes → clean `docker compose up` boots → conventional commit.

---

## File structure

```
package.json                      # root, pnpm workspace scripts
pnpm-workspace.yaml
tsconfig.base.json                # shared compiler options
eslint.config.mjs                 # flat config, root
.prettierrc.json
.gitignore
.env.example                      # all env vars documented
.dockerignore
docker-compose.yml
.github/workflows/ci.yml

packages/shared/                  # @inclination/shared
  package.json  tsconfig.json  src/index.ts  src/env.ts  src/constants.ts
  src/health.ts                   # shared health types
packages/db/                      # @inclination/db
  package.json  tsconfig.json  prisma/schema.prisma  src/index.ts  src/client.ts
packages/editor/                  # @inclination/editor (stub for now)
  package.json  tsconfig.json  src/index.ts

apps/api/                         # @inclination/api (NestJS)
  package.json  tsconfig.json  nest-cli.json
  src/main.ts  src/app.module.ts
  src/health/health.module.ts  src/health/health.controller.ts
  src/health/health.service.ts  src/health/checks.ts
  src/prisma/prisma.service.ts
  src/storage/storage.service.ts # MinIO/S3 client wrapper
  test/health.service.spec.ts             # unit
  test/health.integration.spec.ts         # integration (Testcontainers)
  vitest.config.ts  vitest.integration.config.ts
apps/sync/                        # @inclination/sync (Hocuspocus + http health)
  package.json  tsconfig.json
  src/main.ts  src/server.ts  src/health.ts
  test/health.spec.ts
  vitest.config.ts
apps/web/                         # @inclination/web (Vite React)
  package.json  tsconfig.json  vite.config.ts  index.html
  src/main.tsx  src/App.tsx
  test/app.spec.tsx  vitest.config.ts

infra/docker/api.Dockerfile
infra/docker/sync.Dockerfile
infra/docker/web.Dockerfile
infra/caddy/Caddyfile

e2e/                              # phase gate smoke test
  package.json  smoke.config.ts  tests/phase0-health.spec.ts (Playwright)
scripts/phase0-gate.sh            # compose up + curl /health,/ready for api & sync
```

---

## Task breakdown

| id | title | owns | depends on | parallelizable |
|----|-------|------|-----------|----------------|
| T0 | Root workspace config | root package.json, pnpm-workspace.yaml, tsconfig.base.json, eslint, prettier, .gitignore, .env.example, .dockerignore | — | seed (must be first) |
| T1 | packages/shared | packages/shared/** | T0 | after T0 |
| T2 | packages/db (Prisma) | packages/db/** | T0 | after T0 |
| T3 | packages/editor stub | packages/editor/** | T0 | after T0 |
| T4 | API app + health | apps/api/** | T1,T2 | after T1,T2 |
| T5 | Sync app + health | apps/sync/** | T1,T2 | after T1,T2 |
| T6 | Web app | apps/web/** | T1 | after T1 |
| T7 | Docker + Caddy + Compose | infra/**, docker-compose.yml | T4,T5,T6 | after apps |
| T8 | CI pipeline | .github/workflows/ci.yml | T0..T6 | after packages/apps |
| T9 | E2E phase gate | e2e/**, scripts/phase0-gate.sh | T7 | last |

Because the work is foundational and shares root config, it is executed **serially inline** in the integration order below rather than in parallel worktrees (parallel worktrees would only collide on shared config). This is a deliberate, runbook-sanctioned choice for Phase 0.

**Integration order:** T0 → T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9. Full install + typecheck after package tasks; full compose smoke after T7.

---

## Risks / unknowns & fallback decisions

- **Testcontainers on Windows/Docker Desktop:** should work via the running daemon. Fallback: if Testcontainers cannot reach the daemon in CI, mark the integration suite to run against a compose-provided Postgres/MinIO service in CI instead, and document it.
- **Prisma needs ≥1 model to generate a client:** include a minimal `HealthCheck` model for Phase 0; Phase 1 expands the real schema.
- **Hocuspocus version API:** use `@hocuspocus/server` `Server.configure(...)`; run its websocket on the same HTTP server we use for health. Fallback: separate ports for ws vs health if combining proves brittle.
- **NestJS + Vitest:** use `unplugin-swc`/`@swc/core` or `vite-tsconfig-paths`; fallback to NestJS default Jest if Vitest+Nest decorators misbehave — but spec mandates Vitest, so prefer SWC transform.
- **Caddy auto-TLS in local/CI:** use `:80`/internal TLS-off for CI smoke; real auto-TLS is Phase 9. For Phase 0 gate, Caddy serves over HTTP on a mapped port.

---

## Tasks (TDD, bite-sized)

### Task T0: Root workspace config

**Files:** Create `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc.json`, `.gitignore`, `.dockerignore`, `.env.example`.

- [ ] Write root `package.json` with workspace scripts: `lint`, `typecheck`, `test`, `test:integration`, `build`, `format`. devDeps: typescript, eslint, typescript-eslint, prettier, vitest.
- [ ] Write `pnpm-workspace.yaml` listing `apps/*`, `packages/*`, `e2e`.
- [ ] Write `tsconfig.base.json` (strict, ES2022, moduleResolution Bundler/NodeNext, composite paths to packages).
- [ ] Write flat `eslint.config.mjs` (typescript-eslint recommended + prettier-compat).
- [ ] Write `.prettierrc.json`, `.gitignore` (node_modules, dist, .env, prisma generated, playwright artifacts), `.dockerignore`, `.env.example`.
- [ ] `pnpm install` succeeds; `pnpm lint` and `pnpm typecheck` run (no packages yet → trivially pass).
- [ ] Commit: `chore: scaffold pnpm monorepo root config`.

### Task T1: packages/shared

**Files:** `packages/shared/{package.json,tsconfig.json,src/index.ts,src/constants.ts,src/health.ts,src/env.ts}`

- [ ] Test first: `packages/shared/test/health.spec.ts` asserting `READY_OK`/`READY_FAIL` shape and `serviceHealth(...)` helper builds the readiness payload `{status, checks}`.
- [ ] Run test → fails (module missing).
- [ ] Implement `health.ts` (`HealthStatus`, `ReadinessReport`, `serviceHealth`), `constants.ts`, `env.ts` (typed env reader), `index.ts` re-exports.
- [ ] Run test → passes. typecheck clean.
- [ ] Commit: `feat(shared): health types, env reader, constants`.

### Task T2: packages/db (Prisma)

**Files:** `packages/db/{package.json,tsconfig.json,prisma/schema.prisma,src/index.ts,src/client.ts}`

- [ ] Write `schema.prisma`: postgres datasource from `DATABASE_URL`, generator client, minimal `HealthCheck { id String @id @default(uuid()) checkedAt DateTime @default(now()) }`.
- [ ] `src/client.ts` exports a singleton `PrismaClient`; `index.ts` re-exports client + types.
- [ ] `pnpm --filter @inclination/db prisma generate` succeeds.
- [ ] Create initial migration SQL (generated) committed under `prisma/migrations`.
- [ ] Commit: `feat(db): prisma schema with healthcheck + client`.

### Task T3: packages/editor stub

**Files:** `packages/editor/{package.json,tsconfig.json,src/index.ts}`

- [ ] `index.ts` exports a version constant placeholder (real Tiptap extensions arrive in Phase 4).
- [ ] typecheck clean. Commit: `chore(editor): package stub`.

### Task T4: API app + health (`/health`, `/ready`)

**Files:** `apps/api/**` as listed above.

- [ ] **Unit test first** `test/health.service.spec.ts`:
  - `/health` → `{status:'ok'}`.
  - `/ready` returns `ok` when db check + storage check both resolve; returns `status:'error'` (HTTP 503) when either rejects. Use injected fake checkers.
- [ ] Run → fails.
- [ ] Implement `PrismaService` (`onModuleInit` connect; `ping()` = `$queryRaw\`SELECT 1\``), `StorageService` (S3 client to MinIO; `ping()` = `listBuckets`/`headBucket`), `HealthService.readiness()` aggregating checks via `serviceHealth`, `HealthController` (`GET /health`, `GET /ready` → 200/503), `AppModule`, `main.ts` (global prefix `api`, port from env, Zod/validation pipe).
- [ ] Run unit → passes.
- [ ] **Integration test** `test/health.integration.spec.ts` (Testcontainers Postgres + MinIO): boot containers, set env, instantiate Nest app, `GET /api/ready` → 200 with both checks `up`.
- [ ] Run integration → passes. lint+typecheck clean.
- [ ] Commit: `feat(api): nest app with /health and /ready (db+minio checks)`.

### Task T5: Sync app + health

**Files:** `apps/sync/**`.

- [ ] **Unit test first** `test/health.spec.ts`: the health handler returns 200 for `/health`; `/ready` 200 when db ping resolves, 503 when it rejects (injected ping).
- [ ] Run → fails.
- [ ] Implement `server.ts`: create `@hocuspocus/server` `Server.configure({})` (no persistence yet — Phase 3), and a Node `http`/Express server exposing `/health` and `/ready` (db ping via `@inclination/db`), upgrade `/collab` to Hocuspocus. `main.ts` boots it on `SYNC_PORT`.
- [ ] Run unit → passes. typecheck clean.
- [ ] Commit: `feat(sync): hocuspocus server skeleton with /health and /ready`.

### Task T6: Web app

**Files:** `apps/web/**`.

- [ ] **Test first** `test/app.spec.tsx` (Vitest + @testing-library/react + jsdom): renders `<App/>`, asserts it shows the product name heading.
- [ ] Run → fails.
- [ ] Implement `index.html`, `main.tsx`, `App.tsx` (minimal landing showing app name + a fetch to `/api/health` status indicator), `vite.config.ts` (proxy `/api`→api in dev), `vitest.config.ts` (jsdom).
- [ ] Run test → passes. `pnpm --filter @inclination/web build` produces `dist/`.
- [ ] Commit: `feat(web): vite react SPA shell with health indicator`.

### Task T7: Docker + Caddy + Compose

**Files:** `infra/docker/{api,sync,web}.Dockerfile`, `infra/caddy/Caddyfile`, `docker-compose.yml`.

- [ ] Multi-stage Dockerfiles: shared pnpm build base → per-app runtime. API runs prisma migrate deploy on boot then starts. Web build stage emits static `dist`, served by Caddy (mount or copy).
- [ ] `Caddyfile`: `:80` site → `handle /api/* → reverse_proxy api:3001`, `handle /collab* → reverse_proxy sync:3002`, `handle → reverse_proxy`/`file_server` web static.
- [ ] `docker-compose.yml`: services `postgres` (healthcheck pg_isready), `minio` (healthcheck), `migrate` (one-shot prisma migrate deploy) or fold into api entrypoint, `api` (healthcheck curl /api/health, depends_on db+minio healthy), `sync` (healthcheck /health, depends_on db), `web` (build), `caddy` (depends_on api,sync,web). All env from `.env`.
- [ ] Run `docker compose build` then `docker compose up -d`; wait for healthy; `curl http://localhost:8080/api/health`, `/api/ready`, sync `/health`,`/ready` → all 200.
- [ ] `docker compose down -v`. Commit: `feat(infra): dockerfiles, caddy, docker-compose with healthchecks`.

### Task T8: CI pipeline

**Files:** `.github/workflows/ci.yml`.

- [ ] Workflow on push/PR: setup pnpm+node, `pnpm install --frozen-lockfile`, `prisma generate`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (unit), and a job with Postgres+MinIO services for `pnpm test:integration`.
- [ ] Commit: `ci: lint, typecheck, unit + integration test pipeline`.

### Task T9: E2E phase gate

**Files:** `e2e/**`, `scripts/phase0-gate.sh`.

- [ ] `scripts/phase0-gate.sh`: `docker compose up -d --build`, poll until api+sync healthy, assert 200 on `/api/health`, `/api/ready`, sync `/health`, `/ready`, and web root; on success print PASS; always `docker compose down -v`.
- [ ] Playwright `tests/phase0-health.spec.ts`: load web root through Caddy, expect product name visible and the API-health indicator to read "ok".
- [ ] Run the gate script → PASS.
- [ ] Commit: `test(e2e): phase 0 health gate smoke test`.

---

## Self-review

- **Spec coverage:** monorepo dirs (T0–T6 create all of `apps/web|api|sync`, `packages/db|shared|editor`) ✓; TS/ESLint/Prettier (T0) ✓; Prisma+Postgres (T2,T4) ✓; MinIO (T4 storage check, T7 service) ✓; Caddy (T7) ✓; Compose skeleton (T7) ✓; CI lint+typecheck+test (T8) ✓; `/health`+`/ready` for api & sync (T4,T5) ✓; gate (T9) ✓.
- **Placeholder scan:** editor is an intentional stub (real work Phase 4) and is labeled as such; everything else has concrete content.
- **Type consistency:** `serviceHealth`/`ReadinessReport` defined in T1 and consumed by T4/T5; `PrismaClient` singleton from T2 consumed by T4/T5; `ping()` naming consistent across PrismaService/StorageService.
