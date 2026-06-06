# Phase 2 — Page Tree & Single-User Editor Plan

**Goal:** Page CRUD, nested tree, sidebar with drag-reorder, icons/covers, breadcrumbs, trash + restore, and a Tiptap editor with a starter block set saving to `PageContent` (no live collab yet).

**Gate (spec §8 "Done when"):** pages can be created / nested / moved / trashed / restored and text edits persist across reload.

## Data model (extends packages/db/prisma/schema.prisma; new migration)

```prisma
enum PageType { document database row }

model Page {
  id          String    @id @default(uuid())
  workspaceId String
  parentId    String?
  type        PageType  @default(document)
  title       String    @default("")
  icon        String?
  cover       String?
  sortKey     String                       // fractional-index string for ordering among siblings
  archivedAt  DateTime?
  createdById String
  editedById  String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  parent      Page?     @relation("PageChildren", fields: [parentId], references: [id], onDelete: Cascade)
  children    Page[]    @relation("PageChildren")
  content     PageContent?
  @@index([workspaceId, parentId, archivedAt])
  @@index([parentId, sortKey])
}

// Phase 2 stores the editor doc as ProseMirror/Tiptap JSON. Phase 3 introduces
// ydocState (bytea) + Yjs and migrates this. Documented interim per "no live collab yet."
model PageContent {
  pageId    String   @id
  doc       Json     @default("{}")
  updatedAt DateTime @updatedAt
  page      Page     @relation(fields: [pageId], references: [id], onDelete: Cascade)
}
```
Add `pages Page[]` back-relation to `Workspace`.

## Ordering
Use a fractional-index string `sortKey` so reordering/moving never renumbers siblings. Add a small util in `packages/shared` (`fractionalIndex(before?, after?)`) with unit tests, OR use the `fractional-indexing` npm package (preferred — well-tested). Decision: use `fractional-indexing`.

## API (apps/api/src/pages)
All endpoints under `JwtAuthGuard`; every op authorizes workspace membership via the existing `WorkspacesService.requireMember`. Reuse, don't duplicate.
- `POST   /api/workspaces/:wsId/pages` — create (optional parentId, title, icon); assigns sortKey at end of siblings.
- `GET    /api/workspaces/:wsId/pages` — tree (non-archived) for sidebar (flat list with parentId+sortKey; client builds tree).
- `GET    /api/pages/:id` — page meta + breadcrumbs (ancestor chain).
- `PATCH  /api/pages/:id` — title/icon/cover.
- `POST   /api/pages/:id/move` — `{ parentId, beforeId?, afterId? }` → recompute sortKey (+ guard against cycles: a page cannot be moved under its own descendant).
- `DELETE /api/pages/:id` — soft-delete (set archivedAt; cascade archived state to descendants).
- `POST   /api/pages/:id/restore` — clear archivedAt (and ancestors if needed).
- `GET    /api/workspaces/:wsId/trash` — archived pages.
- `GET    /api/pages/:id/content` / `PUT /api/pages/:id/content` — load/save Tiptap JSON to PageContent.
Validation: Zod schemas in `packages/shared` (createPage, updatePage, movePage, saveContent).

## Web (apps/web)
- App becomes an authenticated shell once logged in: fetch `/api/workspaces` (create a default workspace if none), show a **sidebar** page tree (collapsible, drag-reorder via dnd-kit), **breadcrumbs**, page view with **Tiptap editor** (StarterKit: paragraph, headings, lists, blockquote, code, bold/italic — the Phase-2 starter set), title + icon/cover editing, and a **Trash** view with restore.
- An authenticated API client (attaches Bearer token from the Zustand store; on 401 tries refresh then retries) and TanStack Query for page data.
- Editor autosaves PageContent (debounced) via PUT; loads on open.
- Deps: `@tiptap/react @tiptap/starter-kit @tiptap/pm`, `@tanstack/react-query`, `@dnd-kit/core @dnd-kit/sortable`, `fractional-indexing`.

## Tests
- Unit (Vitest): sortKey/move logic (cycle prevention, ordering), Zod schemas; web: sidebar tree-building, editor save callback (mocked), auth client refresh-on-401.
- Integration (Testcontainers): page CRUD + nest + move (reorder + reparent) + trash/restore + content save/load, all authorized by membership; non-member is forbidden (IDOR check).
- E2E (Playwright, real stack): register→login→create workspace→create pages, nest one under another, reorder, move, trash + restore, type into the editor, reload, assert text persists. Add to e2e suite; reuse Mailpit overlay for verification.

## Out of scope (later phases)
Real-time collab/Yjs (Phase 3); full block set + slash menu + mentions/backlinks (Phase 4); databases (Phase 5).

## Tasks (for subagent-driven execution)
- **T1 backend**: schema+migration, shared Zod + fractional-index dep, PagesModule (service+controller) with authz + cycle guard + content endpoints; unit + integration tests. Wire into AppModule.
- **T2 web**: authenticated API client + query layer; sidebar tree + dnd reorder; page view + Tiptap editor + autosave; breadcrumbs; trash/restore; icons/covers; RTL tests.
- **T3 e2e + gate**: Playwright phase-2 flow; ensure `docker compose up` still healthy with new migration; full DoD.
