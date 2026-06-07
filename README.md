# Inclination

A self-hosted, real-time, Notion-like workspace: collaborative block documents,
relational databases (table / board / calendar / gallery), comments and mentions,
sharing and permissions, public publishing, search, file uploads, and version
history — running entirely on your own infrastructure with **no external SaaS
dependency**.

Everything ships as a single Docker Compose stack fronted by [Caddy](https://caddyserver.com/),
which terminates TLS and serves the SPA plus the API, collaboration, and object
storage routes through one HTTPS entrypoint.

---

## Prerequisites

- **Docker** and the **Docker Compose v2 plugin** (`docker compose …`).
- ~2 GB free RAM and a few GB of disk for the database and object store.
- For a public deployment: a domain name with an `A`/`AAAA` record pointing at the
  host, and ports **80** and **443** reachable (Let's Encrypt needs port 80 for the
  HTTP-01 challenge).

No Node.js toolchain is required to *run* the stack — images build inside Docker.

---

## Quick start (local, self-signed HTTPS)

```bash
git clone <this-repo> inclination
cd inclination

# 1. Generate .env with strong secrets (JWT, Postgres, MinIO).
./scripts/setup-env.sh            # Linux/macOS
#   pwsh scripts/setup-env.ps1    # Windows

# 2. Build and start the stack.
docker compose up -d --build

# 3. Open the app (accept the self-signed certificate the first time).
#    https://localhost:8443
```

On first boot the one-shot `migrate` service applies the database schema and the
`createbuckets` service creates the MinIO bucket; the `api` and `sync` services
wait for those to finish before reporting healthy.

> **Self-signed cert:** by default `CADDY_TLS_SNIPPET=tls_internal`, so Caddy serves
> a certificate from its own internal CA. Your browser will warn once — accept it
> for `localhost`. This is expected for local use and for the test gate.

Health check over TLS:

```bash
curl -k https://localhost:8443/api/health     # -> {"status":"ok"} (HTTP 200)
```

---

## Configuration (`.env`)

`scripts/setup-env.sh` / `setup-env.ps1` copies `.env.example` → `.env` and fills in
strong random values for the secrets (`JWT_ACCESS_SECRET`, `POSTGRES_PASSWORD`,
`MINIO_ROOT_PASSWORD`, `S3_SECRET_KEY`), keeping `DATABASE_URL` and the S3
credentials consistent. Re-running it leaves already-configured secrets in place
(it only replaces blank/known-default values), so it is safe to run again.

> The API runs with `NODE_ENV=production` inside the container and **refuses to boot**
> with a missing or known-weak `JWT_ACCESS_SECRET`. The setup script satisfies this.

Key variables (see `.env.example` for the full annotated list):

| Variable | Purpose |
| --- | --- |
| `APP_DOMAIN` | Hostname Caddy serves. `localhost` for local; your domain for public. |
| `CADDY_TLS_SNIPPET` | `tls_internal` (self-signed) or `tls_auto` (Let's Encrypt). |
| `ACME_EMAIL` | Contact email for Let's Encrypt (used only with `tls_auto`). |
| `CADDY_HTTPS_PORT` | Host port mapped to Caddy `:443` (default `8443`). |
| `CADDY_HTTP_PORT` | Host port mapped to Caddy `:80` (ACME challenge + HTTP→HTTPS redirect). |
| `APP_BASE_URL` / `CORS_ORIGIN` | Public origin the SPA is reached at (used for email links + CORS). |
| `S3_PUBLIC_ENDPOINT` | Browser-reachable origin presigned upload/download URLs are signed against. |

### Configuring a real domain (automatic HTTPS)

Point DNS for e.g. `notes.example.com` at the host, ensure ports 80/443 are open,
then set in `.env`:

```dotenv
APP_DOMAIN=notes.example.com
CADDY_TLS_SNIPPET=tls_auto
ACME_EMAIL=you@example.com
CADDY_HTTPS_PORT=443
CADDY_HTTP_PORT=80

APP_BASE_URL=https://notes.example.com
CORS_ORIGIN=https://notes.example.com
S3_PUBLIC_ENDPOINT=https://notes.example.com
OIDC_REDIRECT_URI=https://notes.example.com/api/auth/oidc/callback
```

Then `docker compose up -d --build`. Caddy obtains and renews a publicly-trusted
certificate automatically and redirects HTTP → HTTPS. Certificates persist in the
`caddy_data` volume across restarts.

**How the TLS switch works:** the Caddyfile uses one site block `{$APP_DOMAIN}` and
`import {$CADDY_TLS_SNIPPET}`. The `tls_internal` snippet expands to `tls internal`
(self-signed) for localhost; the `tls_auto` snippet is empty, so Caddy's default
automatic HTTPS manages a real certificate. All app routes (`/api/*`, `/collab*`,
`/sync/*`, `/inclination/*` → MinIO, SPA fallback) are shared between both modes.

### Behind your own reverse proxy (Cloudflare Tunnel, nginx, Traefik, …)

If something **already terminates TLS** for you, don't make Caddy do it twice —
run Caddy as a plain-HTTP internal router and point your proxy at it. Caddy still
serves the SPA and routes `/api`, `/collab` (WS), `/sync`, and `/inclination`
(MinIO presigned uploads) — your proxy can't do those itself, so this is the
simplest split: **your edge does TLS, Caddy does routing.**

Set in `.env`:

```dotenv
# Caddy serves plain HTTP on :80 — no certs, no HTTP→HTTPS redirect.
APP_DOMAIN=:80
CADDY_TLS_SNIPPET=tls_auto

# Set these to your PUBLIC https URL (what the browser sees), so email links,
# CORS, OIDC, and presigned-upload signatures match the real origin:
APP_BASE_URL=https://notes.example.com
CORS_ORIGIN=https://notes.example.com
S3_PUBLIC_ENDPOINT=https://notes.example.com
OIDC_REDIRECT_URI=https://notes.example.com/api/auth/oidc/callback
```

Then `docker compose up -d --build` and point your proxy at the **caddy container's
port 80** (host `${CADDY_HTTP_PORT}`, default `8080`). **Forward WebSockets** — the
collaborative editor (`/collab`) and database realtime (`/api/realtime`) need them
(Cloudflare Tunnel does this automatically).

**Turnkey Cloudflare Tunnel** (no host ports exposed at all): use the included
overlay. After the `.env` settings above, create a tunnel in the Cloudflare Zero
Trust dashboard, put its token in `.env` as `CLOUDFLARE_TUNNEL_TOKEN=…`, add a
Public Hostname pointing at **Service `http://caddy:80`**, then:

```bash
docker compose -f docker-compose.yml -f docker-compose.cloudflared.yml up -d --build
```

`cloudflared` dials out to Cloudflare (no inbound ports needed); Cloudflare
terminates TLS and forwards your hostname to Caddy over the internal network. See
[`docker-compose.cloudflared.yml`](docker-compose.cloudflared.yml) for the steps.

> **Per-client rate limits behind a proxy:** the API throttles by client IP. Behind
> a tunnel/proxy all requests appear to come from the proxy, so auth rate limits
> become effectively global. If you need precise per-client limits, configure your
> proxy to send `X-Forwarded-For` and add a `trusted_proxies` directive to the
> Caddyfile so the real client IP propagates. Not required for a working install.

### OIDC single sign-on (optional)

Leave the `OIDC_*` variables blank to disable. To enable, register a client with
your identity provider (Authentik, Keycloak, Auth0, etc.) using redirect URI
`https://<your-domain>/api/auth/oidc/callback`, then set:

```dotenv
OIDC_ISSUER=https://idp.example.com
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
OIDC_REDIRECT_URI=https://notes.example.com/api/auth/oidc/callback
```

### Email / SMTP (optional)

With `SMTP_URL` blank the API uses an in-memory capture transport (no mail leaves
the box). To send verification/invitation/reset emails, set an SMTP URL:

```dotenv
SMTP_URL=smtp://user:pass@smtp.example.com:587
MAIL_FROM=Inclination <no-reply@example.com>
```

### Demo data (optional)

To populate a demo workspace (a couple of pages + a sample "Tasks" database),
run the idempotent seed with `SEED_DEMO=true`:

```bash
docker compose run --rm -e SEED_DEMO=true migrate \
  pnpm --filter @inclination/db run seed
```

Without `SEED_DEMO=true` the seed is a no-op, so it never touches a real install.

---

## Backup & restore

Both scripts run against the **live** compose stack and read credentials from `.env`.

### Backup

```bash
./scripts/backup.sh
# -> backups/<timestamp>/db.sql      (pg_dump of Postgres)
# -> backups/<timestamp>/minio/      (mirror of the MinIO bucket)
```

The DB dump uses `--clean --if-exists`; the MinIO mirror is a faithful copy of the
bucket objects.

### Restore

```bash
./scripts/restore.sh backups/<timestamp>
docker compose restart api sync      # reload cached state
```

Restore applies the SQL dump (dropping/recreating the app's objects) and mirrors the
bucket back with `--remove`, so the data ends up identical to the backup.
**This overwrites current data** — take a fresh backup first if unsure.

### Nightly cron suggestion

```cron
# 03:00 daily; keep ~14 days of backups.
0 3 * * * cd /opt/inclination && ./scripts/backup.sh >> backups/backup.log 2>&1 \
  && find backups -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
```

---

## Upgrading

```bash
git pull
docker compose up -d --build
```

Database migrations run automatically on boot: the one-shot `migrate` service
executes `prisma migrate deploy` before `api`/`sync` start (they depend on it
completing successfully), so a fresh schema is applied with no manual step. Caddy
certificates and your data persist in the named volumes (`pgdata`, `miniodata`,
`caddy_data`, `caddy_config`).

---

## Architecture (at a glance)

- **caddy** — TLS termination + single HTTPS entrypoint; serves the SPA and proxies
  `/api/*` → API, `/collab*` + `/sync/*` → sync, `/inclination/*` → MinIO.
- **api** (NestJS) — REST/auth/business logic; `/api/health`, `/api/ready`.
- **sync** (Hocuspocus) — Yjs real-time collaboration over WebSocket.
- **postgres** — primary datastore (Prisma).
- **minio** — S3-compatible object storage for file/image uploads.
- **migrate** / **createbuckets** — one-shot boot tasks (schema, bucket).

See [`docs/superpowers`](docs/superpowers) for the full design spec and build-phase
plans.

---

## Success criteria checklist (spec §10)

A fresh clone → configure `.env` → `docker compose up` produces a TLS-secured,
multi-user, real-time workspace where a team can:

- [ ] write collaborative documents with the full block set, live cursors, and offline-then-sync;
- [ ] run relational task/project databases across table, board, calendar, and gallery views with filters, sorts, grouping, relations, rollups, formulas, sub-items, and dependencies;
- [ ] embed inline and linked databases and synced blocks;
- [ ] comment (page + inline), mention, and get notified;
- [ ] share/permission pages with inheritance, invite guests, and publish public read-only pages;
- [ ] search, upload files/images, and restore prior versions;
- [ ] import from and export to Markdown;
- [ ] all self-hosted, TLS-secured, with backup + restore verified, and no external SaaS dependency.
