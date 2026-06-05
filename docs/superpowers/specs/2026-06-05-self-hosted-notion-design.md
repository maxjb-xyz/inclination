# Self-Hosted Notion — Design Spec

**Status:** Approved design, ready for implementation planning
**Date:** 2026-06-05
**Audience:** An autonomous coding agent that will build the system end to end.

This document is the build contract. The agent works **one phase at a time, top to bottom**, test-first, committing per phase, and must not advance past a phase whose **"Done when"** gate is unverified.

---

## 1. Goal & Scope

Build a fully functional, self-hosted, real-time-collaborative Notion alternative — an "all-in-one workspace": collaborative documents, a nested page tree, and relational databases ("collections") with multiple views (table, board, calendar, gallery), plus comments, sharing/permissions, search, files, version history, public publishing, and Markdown import/export. Everything runs from a single `docker compose up` on one host with no external SaaS dependency.

### In scope
- Multi-user workspaces with roles and invitations.
- Authentication: **email + password** and **OIDC** (generic OpenID Connect — works with Google, GitHub, Keycloak, Authentik, etc.).
- Nested page tree; trash + restore.
- Block-based rich-text editor with the full standard block set, slash menu, drag-and-drop, Markdown shortcuts, nesting, mentions, page links, backlinks.
- **Real-time collaboration**: concurrent editing (CRDT), live presence/cursors, offline edit + reconnect merge.
- **Databases ("collections")**: full typed property system; Table, Board (Kanban), Calendar, Gallery views; filters, sorts, grouping; inline databases; linked database views; relations; rollups; formulas; sub-items & dependencies.
- Comments (page-level + inline-anchored), threads, resolve, mentions, notifications.
- Page-level permissions with tree inheritance; workspace + guest sharing.
- Full-text search; quick switcher / command palette.
- File & image uploads (S3-compatible object storage).
- Page version history (snapshots + restore).
- Public read-only page publishing.
- Markdown / HTML import; Markdown export.
- Dark mode, responsive web layout, keyboard shortcuts, favorites/recents.
- Single-host Docker Compose deployment with auto-TLS, backups, restore, and a self-hosting guide.

### Out of scope (v1)
- Native mobile apps (responsive web only).
- Templates (page/database template gallery).
- SAML / enterprise SSO (OIDC covers the self-host case).
- AI features.
- Web clipper / browser extension.
- Horizontal scaling / Kubernetes (single-host Compose only).

---

## 2. Tech Stack

TypeScript end to end.

| Layer | Choice |
|---|---|
| Frontend | React + TypeScript, Vite |
| Editor | Tiptap (on ProseMirror) + `y-prosemirror` |
| Client data | TanStack Query (server state), Zustand (UI state) |
| CRDT | Yjs |
| Offline | `y-indexeddb` |
| Sync server | Hocuspocus (Yjs websocket server) |
| API server | NestJS |
| API transport | REST + JSON (OpenAPI-documented); websockets for structured-data change events |
| ORM / DB | Prisma + PostgreSQL |
| Object storage | MinIO (S3-compatible), presigned uploads |
| Search | PostgreSQL `tsvector` (default); optional Meilisearch swap-in |
| Auth | JWT access + refresh tokens; Argon2 password hashing; OIDC client |
| Reverse proxy | Caddy (automatic TLS) |
| Tests | Vitest (unit + integration), Testcontainers (real Postgres/MinIO in integration), Playwright (e2e incl. multi-browser) |
| Packaging | pnpm workspaces monorepo; Docker Compose |

### Monorepo layout
```
apps/
  web/      # React SPA
  api/      # NestJS API server
  sync/     # Hocuspocus sync server
packages/
  db/       # Prisma schema + client + migrations
  shared/   # shared types, Zod schemas, constants
  editor/   # Tiptap extensions + custom block nodes (databaseView, syncedBlock, etc.)
infra/
  docker/   # Dockerfiles
  caddy/    # Caddyfile
docker-compose.yml
```

---

## 3. System Architecture

Containers behind a reverse proxy, all in one `docker-compose.yml`:

```
                         ┌──────────────────────────┐
   Browser  ◄──HTTPS───► │  Caddy (reverse proxy)   │
   (React SPA)           └─────────┬────────────────┘
        │                          │
        │  REST + WS               ├──► Web app (static React build)
        ▼                          │
  ┌─────────────┐   REST/tRPC      ├──► API server (NestJS)
  │  API server │◄─────────────────┘        │
  │  (NestJS)   │                            ├─ Auth (email+pw, OIDC)
  └──────┬──────┘                            ├─ Pages / workspaces / permissions
         │                                   ├─ Databases (rows / props / views)
         │                                   ├─ Comments / search / files (presign)
         │                                   └─ Version snapshots
         │
  ┌──────▼───────┐   Yjs over WS    ┌──────────────────┐
  │  Sync server │◄────────────────►│  Browser editors │
  │ (Hocuspocus) │                  └──────────────────┘
  └──────┬───────┘
         │ persist Yjs updates + snapshots
         ▼
  ┌──────────────┐     ┌──────────────┐
  │  PostgreSQL  │     │    MinIO     │
  │  + full-text │     │  (S3 files)  │
  └──────────────┘     └──────────────┘
```

**Components**

1. **Web client** — React SPA. Tiptap block editor bound to Yjs; TanStack Query for relational/REST data; Zustand for UI state.
2. **API server (NestJS)** — owns auth, workspaces, page metadata, the entire database/property/view engine, comments, sharing/permissions, search, file presigning, version snapshots, import/export. Exposes a REST + JSON API (OpenAPI-documented). Talks to Postgres via Prisma. Publishes structured-data change events to clients over websocket.
3. **Sync server (Hocuspocus)** — Yjs websocket server. Authenticates connections via API-issued JWT, authorizes per page, persists Yjs update binaries + periodic snapshots to Postgres, broadcasts presence/cursors. Runs as a separate process from the API.
4. **PostgreSQL** — relational source of truth for metadata + databases; stores Yjs binaries; full-text search via `tsvector`.
5. **MinIO** — S3-compatible object storage; browser uploads via presigned URLs.
6. **Caddy** — terminates HTTPS (auto-TLS), routes `/` (web), `/api` (API), `/collab` (websocket → sync server).

The two-process split (API + sync) is the standard Hocuspocus pattern: it isolates the websocket/CRDT workload from request/response traffic.

---

## 4. Document & Persistence Model (Approach A)

The chosen architecture: **Yjs-authoritative page content; relational metadata + databases.**

- Each page **body** is a single Yjs document containing the block tree (a ProseMirror fragment). This is the source of truth for page content; conflict-free editing, presence, and offline come from the Yjs/Hocuspocus stack.
- Relational tables hold **metadata** (page identity, title, parent, workspace, permissions) and the entire **database engine** (collections), which stays SQL-queryable so filters/sorts/grouping/relations/rollups work at scale.
- Page bodies are not directly SQL-queryable; this is bridged by extracting plain text from the Yjs doc on save into a search index.

**Two real-time mechanisms, each used where correct:**
- **Prose / block structure → Yjs CRDT** (free-form, concurrent, merge-on-conflict).
- **Structured data (database cells, properties, views) → relational + optimistic mutation + event broadcast**, last-write-wins **per cell**. Cells are discrete, typed, independently addressable values; LWW-per-cell is correct, simpler, and keeps data queryable. CRDT is reserved for prose only.

---

## 5. Data Model

A `Page` is the **universal node**: a document, a database container, or a database row are all `Page` records, differentiated by `type`. This is what makes "turn any row into a full page" work.

### Identity & workspace
- **User** — id, email, password_hash (nullable for OIDC-only), oidc_subject (nullable), display_name, avatar_url, timestamps.
- **Workspace** — id, name, icon, settings (JSONB).
- **WorkspaceMember** — (workspace_id, user_id, role: `owner | admin | member | guest`), invited_by, joined_at.
- **Invitation** — workspace_id, email, role, token, expires_at, accepted_at.

### Page tree & content
- **Page** — id, workspace_id, parent_id (self-ref tree; for a database row, parent points at the row's database container or a parent row for sub-items), `type` (`document | database | row`), title, icon, cover, sort_key, archived_at (trash), created_by, edited_by, created_at, updated_at.
- **PageContent** — page_id (1:1), `ydoc_state` (bytea: Yjs update log), updated_at. Present for `document` and `row` pages.
- **PageSnapshot** — id, page_id, `ydoc_snapshot` (bytea), label, author_id, created_at. Powers version history.

### Database engine ("collections")
- **Database** — page_id (the container page, 1:1), default_view_id, subitems_enabled (bool), subitems_property_id (nullable).
- **Property** — id, database_id, name, `type`, `config` (JSONB), order, is_primary (the title column).
  - Types: `text, number, select, multi_select, status, date, person, checkbox, url, email, phone, files, relation, rollup, formula, created_time, created_by, last_edited_time, last_edited_by`.
  - `config` by type: select/multi_select/status → options (id, name, color) and (status) groups; number → format/precision; date → include-time, end-date (ranges); relation → target_database_id, paired_property_id (two-way), is_dependency (+ dependency direction); rollup → relation_property_id, target_property_id, aggregation (`count, sum, avg, min, max, range, show_original, percent_checked, …`); formula → expression (AST/string).
- **Cell** — (row_page_id, property_id, `value` JSONB). One row per populated value; the row's identity is its `Page`. Indexed by `(property_id, …)` for filter/sort performance.
- **RelationLink** — (property_id, from_row_id, to_row_id). Join table; bidirectional; rollups aggregate over it; dependencies are relations with `is_dependency`.
- **View** — id, database_id, `type` (`table | board | calendar | gallery`), name, order, `config` (JSONB).
  - `config`: visible/hidden properties + order; `filters` (AND/OR tree of {property, operator, value}); `sorts` ([{property, direction}]); `group_by` (board column property; also table grouping); `date_property` (calendar); gallery card size + cover source; page-size.
  - **Linked view:** a `View` (and its rendering block node) may reference a `database_id` owned by a different page; the data is not copied.

### Editor block references (custom Tiptap nodes, stored inside the Yjs doc)
- `databaseView { databaseId, viewId }` — inline database embedded in a page body.
- `linkedDatabaseView { databaseId, viewConfig }` — linked view with a local config.
- `syncedBlock { syncedBlockId }` — reference to a shared synced block.
- `pageLink { pageId }`, `mention { kind: user|page, id }`.

### Synced blocks
- **SyncedBlock** — id, workspace_id, `ydoc_state` (bytea). Its **own** Yjs document, keyed `synced:{id}`, served by the sync server to every host page that embeds it. Edit anywhere → updates everywhere, conflict-free.

### Collaboration & social
- **Comment** — id, page_id, block_anchor (nullable: {block_id, from, to} for inline anchoring), thread_id, parent_comment_id, author_id, body (rich text/JSON), resolved_at, created_at.
- **Notification** — id, recipient_id, type (`mention | comment_reply | invite | share | …`), source_ref (JSONB), read_at, created_at.

### Sharing, files, search, quick-access
- **Permission** — id, page_id, subject_type (`user | workspace | public`), subject_id (nullable), role (`full | edit | comment | read`). Inherited down the tree unless an explicit grant overrides.
- **PublicShare** — id, page_id, slug (unique), published (bool), include_subpages (bool), allow_duplicate (bool), created_at.
- **Attachment** — id, page_id, object_key (MinIO), filename, mime, size, uploader_id, created_at.
- **SearchIndex** — page_id, workspace_id, tsvector (title + plain text extracted from the Yjs body on save + database cell text), updated_at.
- **Favorite** — (user_id, page_id, order).
- **RecentlyVisited** — (user_id, page_id, visited_at).

### Permission resolution
For a (user, page): find the nearest explicit `Permission` walking from the page up its ancestors (nearest explicit grant wins); if none, apply the workspace default for the member's role; `guest` members get *no* default access (page-grant only). The same resolver is used by the API and the sync server, and they must agree.

---

## 6. Real-Time Collaboration

**Page bodies**
- One Yjs document per page, id `page:{id}`; Tiptap binds via `y-prosemirror` so the block tree itself is CRDT data.
- Client connects to Hocuspocus over websocket (`/collab`). `onAuthenticate` validates the JWT and runs the per-page permission check; unauthorized → connection rejected. Comment-only/read roles connect read-only.
- `onStoreDocument` (debounced) writes the Yjs update log to `PageContent.ydoc_state`. A scheduled job + significant-change trigger writes `PageSnapshot` rows.
- Yjs **Awareness** carries cursor position, selection, and user identity (name/color) → live remote carets.
- `y-indexeddb` persists the doc locally; offline edits merge on reconnect.
- On save, plain text is extracted from the doc and written to `SearchIndex`.

**Synced blocks** — served as their own Yjs docs keyed `synced:{id}`; every host page subscribes to the same document. No special merge logic.

**Structured data (databases)** — not CRDT. A client edits a cell → mutation to the API → API writes the `Cell`/`RelationLink` row → API publishes a change event on a per-database websocket channel → other clients viewing that database patch their TanStack Query cache. LWW per cell. Formulas/rollups recompute server-side and broadcast results.

---

## 7. Editor Block Set

Inserted via slash menu; drag handle + block menu (duplicate / delete / move / turn-into); Markdown input shortcuts; arbitrary nesting; all round-trip through reload and collaboration.

Text & structure: paragraph, H1–H3, bulleted list, numbered list, toggle list, to-do (checkbox), quote, callout, divider, columns, table of contents.
Code & math: code block (syntax highlighting), inline code, equation (KaTeX).
Media & embeds: image, file, video, bookmark/link preview, generic embed (iframe).
Tables: simple inline table (distinct from databases).
References: page link, `@`-mention (user / page), inline database, linked database view, synced block.

Backlinks: any `pageLink`/page-mention creates a backlink shown on the target page.

---

## 8. Build Phases

Each phase is independently buildable, test-first, and gated. **Definition of Done applies to every phase** (see §9).

### Phase 0 — Foundation
pnpm monorepo (`apps/web`, `apps/api`, `apps/sync`, `packages/db|shared|editor`), TypeScript/ESLint/Prettier, Prisma + Postgres, MinIO, Caddy, Docker Compose skeleton, CI pipeline (lint + typecheck + test).
**Done when:** `docker compose up` boots all services healthy and `/health` + `/ready` pass for API and sync.

### Phase 1 — Auth & workspaces
Email+password (signup, email verification, login, password reset), OIDC login, JWT access + refresh sessions, workspaces, members, roles, invitations, profile/settings.
**Done when:** a user can register, verify, create a workspace, invite a member; both can log in; OIDC login works against a test provider.

### Phase 2 — Page tree & single-user editor
Page CRUD, nested tree, sidebar with drag-reorder, icons/covers, breadcrumbs, trash + restore. Tiptap editor with a starter block set saving to `PageContent` (no live collab yet).
**Done when:** pages can be created / nested / moved / trashed / restored and text edits persist across reload.

### Phase 3 — Real-time collaboration
Hocuspocus sync server, `y-prosemirror` binding, JWT auth + per-page authorization hook, debounced persistence, presence/cursors, offline via `y-indexeddb`, snapshot groundwork.
**Done when:** two browsers edit the same page simultaneously with merged edits and live cursors; offline edits sync on reconnect.

### Phase 4 — Full block editor
All block types (§7), slash menu, drag handle + block menu, Markdown shortcuts, nesting, inline `@`-mentions (users + pages), page links, **backlinks**.
**Done when:** every block type can be inserted via slash menu and round-trips through reload + collaboration; mentioning a page creates a working backlink.

### Phase 5 — Databases (collections)
Database pages; all property types; Cell storage; **Table → Board → Calendar → Gallery** views; per-view filters / sorts / grouping / visible-props; **inline databases**; **linked views**; **relations**; **rollups**; **formulas**; **sub-items & dependencies**; real-time cell updates via broadcast.
**Done when:** a "Tasks" database works as a board grouped by status, a calendar by due date, and a filtered table ("my open tasks"), with a rollup over a linked "Projects" database and at least one working formula; a sub-task nests under a task; edits propagate live to a second browser.

### Phase 6 — Comments, sharing & permissions
Page comments + inline anchored comments, threads, resolve, mentions-in-comments, notifications. Page-level `Permission` grants with tree inheritance + overrides, workspace/guest sharing, share dialog.
**Done when:** a guest invited to one page sees only that subtree (verified at both API and sync layers); comments and @-mentions notify the right users.

### Phase 7 — Search, files & version history
Full-text search (Postgres `tsvector` over title + extracted body + cell text), quick switcher / command palette (⌘K). File/image upload via MinIO presigned URLs. Version history: snapshot browser + restore.
**Done when:** search finds a phrase typed into a page; an uploaded image renders and survives reload; a prior page version can be previewed and restored.

### Phase 8 — Publishing, import/export & synced blocks
Public read-only pages (slug, include-subpages, duplicate toggle); Markdown/HTML import; Markdown export; synced blocks.
**Done when:** a page publishes to a public URL viewable while logged out; a Markdown file imports into a page tree; a synced block edited on one page updates on another.

### Phase 9 — Polish & self-host hardening
Dark mode, responsive layout, keyboard shortcuts, favorites/recents, quick nav. Compose finalization (Caddy auto-TLS, `.env` config, volume backups + restore script), migrations on boot, seed/demo data, security pass (rate limits, input validation, authz audit), self-hosting guide.
**Done when:** a fresh `git clone` → configure `.env` → `docker compose up` yields a working, TLS-secured instance per the README; backup + restore verified.

---

## 9. Cross-Cutting Requirements

### Testing (mandatory, test-first)
- **Unit (Vitest):** property/formula/rollup/filter/sort logic, permission resolution, Markdown import/export, text extraction.
- **Integration (Vitest + Testcontainers):** real Postgres + MinIO; API endpoints; sync server persistence + auth/authz hooks.
- **E2E (Playwright):** each phase's "Done when" gate; multiplayer assertions use **two browser contexts**.
- No phase is complete until all three layers are green and the e2e gate passes.

### Security
- Authorization enforced in **both** the API and the sync server, using the **same** permission resolver; they must agree.
- Input validation at the edge (Zod / class-validator).
- Argon2 password hashing; JWT access + rotating refresh tokens.
- Presigned upload URLs scoped to workspace + content-type + size cap.
- Rate limiting on auth and mutation routes; CORS/CSRF locked to the configured origin.
- Secrets only via environment; no secrets in the image or repo.

### Performance
- Database views: cursor-based pagination + client-side row virtualization.
- `Cell` indexed by `(property_id, …)`; appropriate indexes on tree (`parent_id`), workspace, and search.
- Formulas/rollups computed server-side and cached; invalidated on dependency change.
- Yjs persistence debounced; snapshots pruned on a schedule.

### Ops & observability
- Structured JSON logs; `/health` + `/ready` endpoints.
- Prisma migrations auto-run on boot.
- Nightly Postgres + MinIO backup scripts with a documented restore path.

### Definition of Done (every phase)
Lint + typecheck clean → all three test layers green → phase e2e gate passes → clean `docker compose up` still boots → conventional commit. Only then does the next phase begin.

---

## 10. Success Criteria

A fresh clone → configure `.env` → `docker compose up` produces a TLS-secured, multi-user, real-time Notion-like workspace where a team can:
- write collaborative documents with the full block set, live cursors, and offline-then-sync;
- run relational task/project databases across table, board, calendar, and gallery views with filters, sorts, grouping, relations, rollups, formulas, sub-items, and dependencies;
- embed inline and linked databases and synced blocks;
- comment (page + inline), mention, and get notified;
- share/permission pages with inheritance, invite guests, and publish public read-only pages;
- search, upload files/images, and restore prior versions;
- import from and export to Markdown —

all self-hosted, with no external SaaS dependency.
