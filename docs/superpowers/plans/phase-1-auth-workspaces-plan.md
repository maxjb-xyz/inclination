# Phase 1 — Auth & Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Email+password auth (signup, email verification, login, password reset), OIDC login, JWT access + rotating refresh sessions, and workspaces with members/roles/invitations and profile/settings.

**Architecture:** NestJS feature modules (Auth, Users, Workspaces, Mail) over Prisma/Postgres. Argon2 password hashing; short-lived JWT access tokens + DB-backed rotating refresh tokens (hashed at rest). Generic OIDC via discovery + authorization-code flow; a mock OIDC provider backs tests. Zod schemas in `packages/shared` validate request bodies at the edge. `@nestjs/throttler` rate-limits auth routes; CORS locked to the configured origin.

**Tech Stack:** NestJS 11, Prisma, `argon2`, `@nestjs/jwt`, `@nestjs/passport` + `passport-jwt`, `openid-client` (OIDC), `nodemailer` (SMTP + in-memory test transport), `@nestjs/throttler`, `@nestjs/config`, Zod, Vitest + Testcontainers, Playwright.

---

## Phase scope (spec §8) — acceptance target

> **Phase 1 — Auth & workspaces:** Email+password (signup, email verification, login, password reset), OIDC login, JWT access + refresh sessions, workspaces, members, roles, invitations, profile/settings.
> **Done when:** a user can register, verify, create a workspace, invite a member; both can log in; OIDC login works against a test provider.

DoD (spec §9): lint+typecheck clean → unit/integration/e2e green → gate passes → clean `docker compose up` → conventional commits. Security (spec §9): Argon2, rotating refresh, edge validation, rate limits, CORS locked, secrets via env.

---

## Data model (extends `packages/db/prisma/schema.prisma`)

```prisma
enum WorkspaceRole { owner admin member guest }

model User {
  id              String    @id @default(uuid())
  email           String    @unique
  passwordHash    String?
  oidcSubject     String?
  oidcIssuer      String?
  displayName     String
  avatarUrl       String?
  emailVerifiedAt DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  memberships     WorkspaceMember[]
  refreshTokens   RefreshToken[]
  @@unique([oidcIssuer, oidcSubject])
}

model Workspace {
  id        String   @id @default(uuid())
  name      String
  icon      String?
  settings  Json     @default("{}")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  members   WorkspaceMember[]
  invitations Invitation[]
}

model WorkspaceMember {
  id          String        @id @default(uuid())
  workspaceId String
  userId      String
  role        WorkspaceRole
  invitedById String?
  joinedAt    DateTime      @default(now())
  workspace   Workspace     @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user        User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([workspaceId, userId])
  @@index([userId])
}

model Invitation {
  id          String        @id @default(uuid())
  workspaceId String
  email       String
  role        WorkspaceRole
  tokenHash   String        @unique
  expiresAt   DateTime
  acceptedAt  DateTime?
  invitedById String
  createdAt   DateTime      @default(now())
  workspace   Workspace     @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  @@index([workspaceId])
}

model RefreshToken {
  id           String    @id @default(uuid())
  userId       String
  tokenHash    String    @unique
  expiresAt    DateTime
  createdAt    DateTime  @default(now())
  revokedAt    DateTime?
  replacedById String?
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}

model EmailVerificationToken {
  id         String    @id @default(uuid())
  userId     String
  tokenHash  String    @unique
  expiresAt  DateTime
  consumedAt DateTime?
  createdAt  DateTime  @default(now())
}

model PasswordResetToken {
  id         String    @id @default(uuid())
  userId     String
  tokenHash  String    @unique
  expiresAt  DateTime
  consumedAt DateTime?
  createdAt  DateTime  @default(now())
}
```
The Phase 0 `HealthCheck` model stays. A new migration adds these tables/enum.

---

## File structure

```
packages/db/prisma/schema.prisma                 # +models above; new migration
packages/shared/src/auth-schemas.ts              # Zod: register/login/reset/profile/workspace/invite + inferred types
packages/shared/src/index.ts                     # re-export

apps/api/src/config/                             # env config (typed)
apps/api/src/prisma/prisma.module.ts             # @Global module exposing PrismaService
apps/api/src/auth/
  password.service.ts (+ spec)                   # argon2 hash/verify
  token.service.ts (+ spec)                      # access JWT + refresh issue/rotate/verify/revoke
  auth.service.ts (+ spec)                        # register/verify/login/refresh/logout/reset
  oidc.service.ts (+ spec)                        # discovery, auth URL, callback exchange, user upsert
  auth.controller.ts                              # REST endpoints
  oidc.controller.ts                              # /auth/oidc/login, /auth/oidc/callback
  jwt.strategy.ts / jwt-auth.guard.ts             # access-token guard
  current-user.decorator.ts
  auth.module.ts
apps/api/src/users/ (service+controller+module)  # GET/PATCH /users/me
apps/api/src/workspaces/
  workspaces.service.ts (+ spec)                  # create/list/get/update/members
  invitations.service.ts (+ spec)                 # invite/accept/list
  workspaces.controller.ts / invitations.controller.ts / workspaces.module.ts
apps/api/src/mail/
  mail.service.ts                                 # transport-agnostic send
  transports.ts                                   # smtp (nodemailer) + in-memory test transport
  mail.module.ts
apps/api/src/app.module.ts                        # wire modules, ThrottlerModule, ConfigModule, global ValidationPipe (zod)
apps/api/src/common/zod-validation.pipe.ts        # Zod body validation
apps/api/test/*.integration.spec.ts               # Testcontainers: auth flow, workspace+invite, oidc(mock), refresh rotation
apps/api/test/support/mock-oidc.ts                # in-process mock OIDC provider for tests

apps/web/src/auth/                                # minimal login/register/verify pages + auth store/client
e2e/tests/phase1-auth.spec.ts                     # gate: register→verify→login→workspace→invite→2nd login; OIDC via mock
```

---

## Task breakdown & dependency graph

| id | title | owns | depends on |
|----|-------|------|-----------|
| A1 | Prisma schema + migration (User/Workspace/Member/Invitation/tokens) | packages/db/** | — |
| A2 | Shared Zod auth/workspace schemas | packages/shared/src/auth-schemas.ts | — |
| A3 | Config + global Prisma module + Zod validation pipe + Mail module | apps/api/src/{config,prisma,common,mail}/** | A1 |
| A4 | PasswordService + TokenService (+ refresh rotation) | apps/api/src/auth/{password,token}.service.* | A1,A3 |
| A5 | AuthService + AuthController (register/verify/login/refresh/logout/reset) + JWT guard | apps/api/src/auth/** (rest) | A2,A4 |
| A6 | UsersModule (profile/settings) | apps/api/src/users/** | A5 |
| A7 | WorkspacesModule + InvitationsModule | apps/api/src/workspaces/** | A5 |
| A8 | OIDC (mock provider + service + controller) | apps/api/src/auth/oidc.* , test/support/mock-oidc.ts | A4,A5 |
| A9 | Web auth surface (login/register/verify) | apps/web/src/auth/** | A5 (API contract) |
| A10 | Integration tests (Testcontainers) for A5–A8 | apps/api/test/*.integration.spec.ts | A5–A8 |
| A11 | E2E gate (Playwright, API-driven + OIDC mock) | e2e/tests/phase1-auth.spec.ts | A5–A9 |

**Waves (inline serial execution; shared schema/config):** A1·A2 → A3 → A4 → A5 → {A6, A7, A8} → A9 → A10 → A11.

**Integration order:** same as waves; full test suite after each.

---

## Risks / fallbacks

- **OIDC test provider:** use an in-process mock issuer (`apps/api/test/support/mock-oidc.ts`) implementing `/.well-known/openid-configuration`, `/authorize` (auto-approve → redirect with code), `/token` (signed id_token via `jose`), `/jwks`. Fallback: `oidc-provider` lib if the hand-rolled mock proves insufficient. Decision recorded in journal.
- **Email sending:** `MailService` with a pluggable transport; default SMTP via `nodemailer`, an in-memory `CapturingTransport` for tests/dev that records messages so tests can read the verification/reset/invite token. In dev (no SMTP configured) it logs the link. No real email server needed for the gate.
- **CSRF:** API is token-bearer (Authorization header), not cookie-session for the SPA's API calls → CSRF surface minimal; lock CORS to `APP_DOMAIN`. Refresh token returned in body and stored by client; (HttpOnly-cookie refresh is a Phase 9 hardening option). Record decision.
- **Refresh rotation reuse detection:** on presenting a revoked/rotated refresh token, revoke the whole token chain for that user (token theft mitigation).

---

## Key contracts (used across tasks)

- `PasswordService.hash(pw): Promise<string>` (argon2id), `.verify(hash, pw): Promise<boolean>`.
- `TokenService.issueAccess(user): string` (JWT, `sub`, `email`, exp ~15m), `.verifyAccess(jwt)`, `.issueRefresh(userId): Promise<{token, record}>` (random 256-bit, stored hashed, exp ~30d), `.rotate(presented): Promise<{access, refresh}>` (verify→revoke→issue, reuse-detection), `.revokeAll(userId)`.
- `AuthService`: `register(input)`, `verifyEmail(token)`, `login(email,pw)`, `refresh(token)`, `logout(token)`, `requestPasswordReset(email)`, `resetPassword(token,newPw)`. Login requires `emailVerifiedAt != null` for password users.
- HTTP: `POST /api/auth/register|verify-email|login|refresh|logout`, `POST /api/auth/password-reset/request|confirm`, `GET /api/auth/me`, `GET /api/auth/oidc/login`, `GET /api/auth/oidc/callback`; `GET/PATCH /api/users/me`; `POST/GET /api/workspaces`, `GET/PATCH /api/workspaces/:id`, `GET /api/workspaces/:id/members`, `POST /api/workspaces/:id/invitations`, `POST /api/invitations/accept`.

---

## Tasks (TDD) — abbreviated; each follows write-test → see-fail → implement → see-pass → commit

### A1: Schema + migration
- [ ] Add models/enum above to `schema.prisma`.
- [ ] `prisma generate`; generate migration SQL (`migrate diff` baseline addition) into a new `prisma/migrations/<ts>_auth_workspaces/`.
- [ ] Typecheck db. Commit `feat(db): auth + workspace data model`.

### A2: Shared Zod schemas
- [ ] Test: `auth-schemas.spec.ts` — valid/invalid register (email format, password ≥10 chars), login, reset, createWorkspace (name 1..100), invite (email + role in WORKSPACE_ROLES minus owner).
- [ ] Implement Zod schemas + `z.infer` exports; re-export from index.
- [ ] Commit `feat(shared): zod schemas for auth and workspaces`.

### A3: Config, Prisma module, Zod pipe, Mail
- [ ] `config`: typed loader (JWT secrets, token TTLs, OIDC issuer/client, SMTP, APP_DOMAIN) from env via `@nestjs/config`.
- [ ] `PrismaModule` `@Global` providing existing `PrismaService`.
- [ ] `ZodValidationPipe` (test: passes valid, throws 400 on invalid).
- [ ] `MailModule`: `MailService.send(...)` + `CapturingTransport` (test: captures message) + SMTP transport.
- [ ] Commit `feat(api): config, global prisma module, zod pipe, mail module`.

### A4: Password + Token services
- [ ] PasswordService spec: hash≠plaintext, verify true/false. Implement argon2id.
- [ ] TokenService spec: access verifies + carries sub; refresh stored hashed; rotate revokes old + issues new; **reuse of a revoked refresh revokes all + throws**; expired refresh rejected. Implement with `@nestjs/jwt` + crypto random + prisma.
- [ ] Commit `feat(api): argon2 passwords and rotating jwt sessions`.

### A5: Auth service + controller + guard
- [ ] AuthService specs (unit with prisma test-double or thin integration): register creates unverified user + sends verification; duplicate email rejected; verify marks verified + consumes token; login rejects unverified / bad password, returns tokens when ok; password reset request+confirm; logout revokes refresh.
- [ ] JwtAuthGuard + JwtStrategy; `@CurrentUser()`. `/auth/me` returns the authenticated user.
- [ ] Throttler on auth routes. Commit `feat(api): email/password auth with verification, reset, sessions`.

### A6: Users (profile/settings)
- [ ] Spec: GET /users/me returns profile; PATCH updates displayName/avatarUrl (validated); unauthorized → 401.
- [ ] Commit `feat(api): user profile endpoints`.

### A7: Workspaces + invitations
- [ ] WorkspacesService spec: create makes creator an `owner` member; list returns only my workspaces; get/update authorized to members/admins; members list.
- [ ] InvitationsService spec: invite creates token + emails it; accept (existing or new verified user) adds membership with invited role; expired/used token rejected; only owner/admin may invite.
- [ ] Controllers + role-guard. Commit `feat(api): workspaces, members, roles, invitations`.

### A8: OIDC
- [ ] `mock-oidc.ts` test provider (discovery/authorize/token/jwks via `jose`).
- [ ] OidcService spec (integration vs mock): login URL built from discovery; callback exchanges code → claims; upserts user by (issuer,subject), marks email verified; issues our tokens.
- [ ] OidcController: `/auth/oidc/login` → 302 to provider; `/auth/oidc/callback` → tokens.
- [ ] Commit `feat(api): generic OIDC login`.

### A9: Web auth surface
- [ ] Tests (Vitest + RTL): register form validates + submits; login stores tokens; verify page calls API. Minimal pages + an `authClient` + token store (Zustand) + TanStack Query setup.
- [ ] Commit `feat(web): auth pages and client`.

### A10: Integration tests (Testcontainers)
- [ ] Real Postgres: full register→verify(token from CapturingTransport)→login→refresh-rotate→workspace create→invite→accept→second login. OIDC against in-process mock. Assert DB state + token semantics.
- [ ] Commit `test(api): auth + workspace integration coverage`.

### A11: E2E gate (Playwright)
- [ ] `phase1-auth.spec.ts` (API request-context + mock OIDC, plus a UI smoke for login): user registers, verifies, logs in, creates a workspace, invites a member; the invited user accepts and logs in; OIDC login yields a session. This is the spec's "Done when".
- [ ] Update `docker-compose.yml`/`.env.example` with new env (JWT secrets, OIDC, SMTP) and ensure `docker compose up` still boots healthy (migrations include new tables).
- [ ] Commit `test(e2e): phase 1 auth & workspace gate`.

---

## Self-review
- **Spec coverage:** signup/verify/login/reset (A5), OIDC (A8), JWT access+rotating refresh (A4), workspaces/members/roles/invitations (A7), profile/settings (A6), validation+rate-limit+CORS+argon2+secrets-via-env (A2,A3,A4,A5). Gate (A10,A11).
- **Naming:** entities/roles match spec §5 (`owner|admin|member|guest`, User/Workspace/WorkspaceMember/Invitation).
- **Placeholders:** mock-OIDC and CapturingTransport are deliberate test infrastructure, documented; no TODOs.
