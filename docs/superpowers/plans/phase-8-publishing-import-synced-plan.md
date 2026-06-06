# Phase 8 — Publishing, Import/Export & Synced Blocks Plan

**Goal:** Public read-only pages (slug, include-subpages, duplicate toggle); Markdown/HTML import; Markdown export; synced blocks.

**Gate (spec §8):** a page publishes to a public URL viewable while logged out; a Markdown file imports into a page tree; a synced block edited on one page updates on another.

## Data model (spec §5; packages/db)
- **PublicShare** — `id, pageId (unique), slug (unique), published bool, includeSubpages bool, allowDuplicate bool, publishedHtml text?, publishedTitle text?, createdAt, updatedAt`. (We store the rendered HTML at publish time — see decision below.)
- **SyncedBlock** — `id, workspaceId, ydocState Bytes?, createdAt`. Its OWN Yjs doc, keyed `synced:{id}`, served by the sync server to every host page that embeds it.
- (Phase 6 `Permission.subjectType='public'` already resolves to read; PublicShare is the publishing surface.)
Migration `publishing_synced`.

## Publishing (apps/api + apps/web)
- **Decision (fidelity vs simplicity):** publishing stores a **client-rendered HTML snapshot** of the page at publish time (the web app has the Tiptap editor; it serializes the current doc → HTML and sends it to the publish endpoint). The public endpoint serves that HTML. Re-publishing refreshes it. (Live public pages that always reflect the latest edit = a follow-up; for v1 the gate is "publishes to a public URL viewable while logged out".)
- API: `POST /api/pages/:id/publish` (canShare) body `{ slug?, includeSubpages, allowDuplicate, html, title }` → upsert PublicShare (generate a unique slug from title if none), set published=true. `POST /api/pages/:id/unpublish`. `GET /api/pages/:id/public-share` (current settings).
- **Public read endpoint (NO auth):** `GET /api/public/:slug` → `{ title, html, includeSubpages, allowDuplicate, subpages?: [{slug,title}] }` for a published share; 404 otherwise. (If includeSubpages, list published descendants.) This must NOT require a JWT and must NOT leak unpublished content.
- Web: a **Publish dialog** (publish/unpublish, copy public URL, toggles), and a **public route** (e.g. `/public/:slug`) that renders the published HTML read-only WITHOUT authentication (the SPA detects the public route and skips the auth gate). Sanitize the rendered HTML on display (the publish HTML comes from our editor, but treat defensively).

## Import / Export (apps/api or a shared/pure module + web)
- **Markdown export:** page (its Yjs/PM doc) → Markdown string. Implement a PM-JSON→Markdown serializer (pure, in packages/editor or a shared module) covering the Phase-4 block set (headings, lists, todo, quote, code, callout→blockquote, divider, tables, links, mentions→text/links, images). `GET /api/pages/:id/export/markdown` (canRead) → text/markdown (or the web does it client-side from the editor doc — pick one; server-side is shareable). 
- **Markdown/HTML import:** parse Markdown (and basic HTML) → a page tree (a top page + nested pages for `#`-heading sections, or one page with the content; spec gate = "imports into a page tree"). `POST /api/workspaces/:wsId/import/markdown` (member) body `{ filename, markdown }` (or multipart) → create Page(s) + seed PageContent (PM JSON / Yjs). Use a Markdown→PM-JSON parser (e.g. a pure module using `marked`/`markdown-it` → map tokens to the block set). Create at least a page tree when the markdown has top-level headings as sections (document the splitting rule).
- Web: an Import action (upload .md → calls import → navigates to the new tree) and an Export action (download .md).

## Synced blocks (apps/api + apps/sync + apps/web)
- API: `POST /api/workspaces/:wsId/synced-blocks` → create a SyncedBlock (returns id). 
- **Sync server:** extend `collab.ts`/`server.ts` to also serve `synced:{id}` documents — onAuthenticate for a `synced:{id}` doc verifies the JWT + checks the user is a member of the SyncedBlock's workspace (or can access a host page — keep it workspace-membership for v1); the Database extension fetch/store persists to `SyncedBlock.ydocState`. Same Hocuspocus server, different doc-name prefix.
- Web: the `syncedBlock` editor node (Phase-4 stub) → a NodeView that mounts a nested collaborative Tiptap editor bound to a HocuspocusProvider for `synced:{id}`. Embedding the same syncedBlockId on two pages → same doc → edits propagate. A slash action "Synced block" creates one and inserts the node.

## Tests
- Unit: slug generation/uniqueness; PM-JSON→Markdown serializer (each block type); Markdown→PM-JSON parser + page-tree splitting; public-share shape (no unpublished leak); synced doc-name parsing/auth.
- Integration (Testcontainers): publish → `GET /public/:slug` (no auth header) returns html + 404 for unpublished/unknown; unpublish hides it; import markdown → pages created with content; export returns markdown; synced-block create + the sync `synced:{id}` auth (member allowed, non-member rejected) + fetch/store round-trip.
- E2E (Playwright): owner publishes a page → open `/public/:slug` in a NEW context with NO auth (clear storage) → the published content is visible. Import a .md file → a page tree appears in the sidebar. Create a synced block on page A, type into it; embed the same synced block on page B (or open A in two contexts) → the edit appears on the other. This is the gate.

## Tasks (subagent-driven)
- **T1 backend**: PublicShare + SyncedBlock models + migration; publish/unpublish + public read (no-auth) API; markdown import/export (pure serializer/parser + endpoints); synced-block create + sync server `synced:{id}` serving/auth. Integration tests.
- **T2 web**: publish dialog + public (logged-out) route/render; import/export UI; synced-block NodeView (nested collab editor). Unit tests.
- **T3 e2e + gate**: publish→logged-out view, import→tree, synced-block propagation; docker boot healthy; full DoD.

## Out of scope
Public page commenting/duplication-into-own-workspace beyond the toggle flag; templates.
