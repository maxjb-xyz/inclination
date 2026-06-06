# Phase 7 — Search, Files & Version History Plan

**Goal:** Full-text search (Postgres `tsvector` over title + extracted body + cell text), quick switcher / command palette (⌘K), file/image upload via MinIO presigned URLs, version history (snapshot browser + restore).

**Gate (spec §8):** search finds a phrase typed into a page; an uploaded image renders and survives reload; a prior page version can be previewed and restored.

## Data model (spec §5; packages/db)
- **SearchIndex** — `pageId @id`, `workspaceId`, `title text`, `bodyText text`, `tsv` (Postgres `tsvector`, generated or maintained), `updatedAt`. (Prisma can't fully model tsvector; use `Unsupported("tsvector")?` + a GIN index added via raw SQL in the migration, and maintain `tsv` via `to_tsvector` in the upsert SQL or a trigger.)
- **Attachment** — `id, pageId?, workspaceId, objectKey, filename, mime, size, uploaderId, createdAt` (spec §5), `@@index([pageId])`.
- **PageSnapshot** already exists (Phase 3). Add `label`/author already present.
Migration `search_files`.

## Search (apps/api + apps/sync)
- **Indexing:** plain text extracted from the Yjs doc on save → SearchIndex. The **sync server** (onStoreDocument, already persisting ydocState) extracts text from the Yjs XML fragment (a small walker) and upserts `SearchIndex.bodyText` + recomputes `tsv`; the **API** updates `title` on page rename and `bodyText`/cell-text contributions for database rows (cells) on cell change. Maintain `tsv = to_tsvector('english', coalesce(title,'')||' '||coalesce(bodyText,''))` via raw SQL upsert (or a Postgres trigger created in the migration — preferred: a trigger keeps tsv consistent regardless of writer).
- **Search API:** `GET /api/workspaces/:wsId/search?q=` → full-text query (`tsv @@ websearch_to_tsquery('english', q)`, ranked by `ts_rank`), returning pages the user can access (filter via resolver or join on membership; for guests, post-filter by resolvePageAccess), with title + a snippet (`ts_headline`). Scope to the workspace.

## Files (apps/api + apps/web)
- **Presigned upload:** `POST /api/workspaces/:wsId/uploads/presign` body `{ filename, mime, size }` → validates content-type allowlist + size cap (spec §9), generates a MinIO presigned PUT URL scoped to a generated objectKey (`{workspaceId}/{uuid}/{filename}`), records an `Attachment` (pending) row; returns `{ uploadUrl, objectKey, attachmentId }`. Client PUTs the bytes directly to MinIO. 
- **Download/serve:** `GET /api/attachments/:id` → presigned GET URL (or stream) for an accessible attachment (authorized via the page/workspace). The image/file/video blocks (Phase 4) now store the attachment's served URL/objectKey.
- Web: image/file blocks get an upload affordance (file picker → presign → PUT → set node src to the served URL). Authz: upload requires workspace membership + write; download requires access.

## Version history (apps/api + apps/web)
- `GET /api/pages/:id/snapshots` → list PageSnapshots (id, label, author, createdAt) for an accessible page.
- `GET /api/pages/:id/snapshots/:snapId` → the snapshot's content (decoded to ProseMirror JSON for preview, or raw bytes) for read-only preview.
- `POST /api/pages/:id/snapshots/:snapId/restore` (requires canWrite) → set `PageContent.ydocState` to the snapshot bytes (becomes current on next load/reconnect); optionally also write a new snapshot of the pre-restore state. Document: live-connected clients pick it up on reload/reconnect (full live-restore is a follow-up).
- Also allow manual snapshot creation `POST /api/pages/:id/snapshots` (label) — handy for the gate.
- Web: a version-history panel listing snapshots, preview (render read-only), and a Restore button.

## Web — command palette
- ⌘K quick switcher / command palette: search pages by title + full-text via the search API (debounced), arrow/enter to navigate; also quick actions (new page, go to trash). 

## Tests
- Unit: Yjs→text extraction walker; search query builder/ranking shaping; presign objectKey + content-type/size validation; snapshot decode to JSON.
- Integration (Testcontainers Postgres + MinIO): index a page's text → search finds the phrase (and does NOT return inaccessible pages for a guest); presign returns a working URL + Attachment row + size/type rejection (400); snapshot list + restore replaces ydocState; search ranking.
- E2E (Playwright, real stack incl. MinIO): type a distinctive phrase into a page → ⌘K / search finds it and navigates; upload an image into an image block → it renders and survives reload (served from MinIO); create/restore a snapshot → restored content appears after reload. This is the gate.

## Tasks (subagent-driven)
- **T1 backend**: SearchIndex/Attachment models + migration (+ tsv trigger/GIN); Yjs text extraction + index maintenance (sync onStoreDocument + API title/cell hooks); search API; presign upload + attachment download API (MinIO, scoped + caps); snapshot list/preview/restore + manual snapshot API. Integration tests (Postgres + MinIO).
- **T2 web**: ⌘K command palette + search results/nav; file/image upload wiring in the editor media blocks (presign → PUT → render); version-history panel (list/preview/restore). Unit tests.
- **T3 e2e + gate**: search-finds-phrase, image-upload-renders-survives-reload, snapshot-restore; docker boot healthy; full DoD.

## Out of scope
Optional Meilisearch swap (Postgres tsvector is the default); public publishing (Phase 8).
