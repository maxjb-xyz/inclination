# Phase 6 — Comments, Sharing & Permissions Plan

**Goal:** Page comments + inline anchored comments, threads, resolve, mentions-in-comments, notifications. Page-level `Permission` grants with tree inheritance + overrides, workspace/guest sharing, share dialog.

**Gate (spec §8):** a guest invited to one page sees only that subtree (verified at BOTH API and sync layers); comments and @-mentions notify the right users.

## The crux — permission resolver (spec §5, §9 invariant)
Upgrade the shared `resolvePageAccess` (packages/db/src/permissions.ts) — used by BOTH the API and the sync server — to the full algorithm:
> For a (user, page): walk from the page up its ancestors; the **nearest explicit `Permission`** grant for that user (or for a workspace/everyone subject the user belongs to) wins. If no explicit grant on the path, apply the **workspace default for the member's role** (owner/admin/member → full/edit; configurable). **`guest` members get NO default access** — page-grant only. Return a role → `{canRead, canComment, canWrite, canShare}`.
- Role → capabilities: `full` (read+comment+write+share/manage), `edit` (read+comment+write), `comment` (read+comment), `read` (read). Workspace roles map: owner→full, admin→full, member→edit (default), guest→none-without-grant.
- Resolver returns `{ role, canRead, canComment, canWrite, canShare } | null` (null = no access). API + sync must agree; keep it pure (inject prisma) + exhaustively unit-tested.
- **Wire capabilities everywhere:** API write endpoints (pages content/title, database cells/rows/etc.) require `canWrite`; comment create requires `canComment`; sharing requires `canShare`. Sync server sets `readOnly` when `!canWrite` (already wired via the resolver's canWrite). Fixes the Phase-3 follow-up.

## Data model (spec §5; packages/db)
- **Permission** — `id, pageId, subjectType (user|workspace|public), subjectId? (userId or workspaceId; null for public), role (full|edit|comment|read), createdAt`, `@@index([pageId])`, unique on `(pageId, subjectType, subjectId)`. (public subject is used by Phase 8 publishing; Phase 6 supports user/workspace.)
- **Comment** — `id, pageId, blockAnchor Json?` ({blockId, from, to} for inline), `threadId`, `parentCommentId?`, `authorId`, `body Json` (rich text), `resolvedAt?`, `createdAt`, indexes on pageId + threadId.
- **Notification** — `id, recipientId, type (mention|comment_reply|invite|share|...)`, `sourceRef Json`, `readAt?`, `createdAt`, index on recipientId.
Migration `comments_permissions`.

## API (apps/api)
- **Permissions/Sharing** (apps/api/src/sharing): `GET /pages/:id/permissions`, `PUT /pages/:id/permissions` (grant/update a user/workspace role — requires canShare), `DELETE /pages/:id/permissions/:permId`. Inviting a **guest to a page**: create/ensure a workspace membership with role `guest` (no workspace default access) + a `Permission` grant on that page for the user (reuse the Phase-1 invitation flow or a direct share-by-email that creates a guest membership + page grant). Share dialog data endpoint.
- **Comments** (apps/api/src/comments): CRUD `POST/GET /pages/:id/comments` (page-level + inline with blockAnchor), reply (parentCommentId/threadId), `POST /comments/:id/resolve` (+unresolve), list threads for a page. Create requires `canComment`. Mentions-in-comments parse `mention` nodes → create `Notification` for mentioned users (with access). 
- **Notifications** (apps/api/src/notifications): `GET /notifications` (mine), `POST /notifications/:id/read`, `POST /notifications/read-all`, unread count. Created on: comment mention, comment reply (notify thread participants/author), share grant, (invite already from Phase 1). Optional realtime push (reuse socket gateway or a user channel) — nice-to-have; the gate only needs persisted notifications to the right users.
- All authorized via the upgraded resolver.

## Web (apps/web)
- **Share dialog** on a page: list current permissions, add a person/workspace with a role, remove; "invite guest by email to this page". Gated on canShare.
- **Comments**: a comments sidebar/panel (page-level thread list, resolve), and **inline anchored comments** (select text in the editor → add comment; highlight anchored ranges; click to view thread). Mentions in the comment composer (reuse @-mention search). 
- **Notifications**: an inbox (list, mark read, unread badge).
- Respect capabilities in the UI (hide edit affordances when read/comment-only).

## Tests
- Unit (critical): the resolver — explicit grant on the page; nearest-ancestor grant wins; override (closer grant beats farther); workspace-default by role; **guest = no access without a grant, access only on the granted subtree**; workspace-subject grant; capability mapping per role. (Pure, fake prisma.)
- Integration (Testcontainers): grant a user `read` on a page → they can GET it but not write (403 on content/cell write); guest invited to one page can access that page + descendants but NOT siblings/ancestors (403) — **assert at the API layer**; comment create requires canComment; mention-in-comment creates a Notification for the mentioned user; resolve toggles; notifications list/mark-read. **Sync-layer guest check**: the sync `authenticatePage`/`resolvePageAccess` rejects the guest on a non-granted page and allows the granted one (assert via the sync collab auth fn).
- E2E (Playwright): owner creates pages A (with child A1) and B; invites a GUEST to page A; the guest logs in and can open A + A1 but NOT B (API 403 / not visible), AND a collab websocket connection to B is rejected while A is accepted (sync layer). Owner @-mentions the guest in a comment on A → the guest's notification inbox shows it. This is the gate.

## Tasks (subagent-driven)
- **T1 resolver + models**: Permission/Comment/Notification models + migration; upgrade shared `resolvePageAccess` to tree-inheritance + roles + capabilities; wire canWrite/canComment/canShare into existing API write/sync paths (pages, databases, sync). Exhaustive resolver unit tests + adjust existing tests. (foundation — gate hinges here)
- **T2 comments + notifications API**: comments CRUD/threads/resolve/inline anchors + mentions→notifications + notifications API; integration tests (incl. guest subtree scoping at API + sync).
- **T3 sharing API + web**: share/permission endpoints + guest-to-page invite; share dialog, comments panel + inline comments, notifications inbox (web); capability-aware UI; unit tests.
- **T4 e2e + gate**: guest-subtree-only (API + sync) + comment-mention-notifies; docker boot healthy; full DoD.

## Out of scope
Public read-only publishing (Phase 8 — `Permission` public subject + PublicShare); search (Phase 7).
