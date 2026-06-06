# Phase 3 — Real-Time Collaboration Plan

**Goal:** Hocuspocus sync server with `y-prosemirror` binding, JWT auth + per-page authorization hook (same resolver as the API), debounced persistence, presence/cursors, offline via `y-indexeddb`, snapshot groundwork.

**Gate (spec §8):** two browsers edit the same page simultaneously with merged edits and live cursors; offline edits sync on reconnect.

## Key architecture (spec §4, §6)
- Page body becomes a **Yjs document** id `page:{id}`; Tiptap binds via `y-prosemirror`. Yjs is authoritative for content now.
- Sync server persists Yjs update binaries to `PageContent.ydocState`; debounced.
- **Authorization enforced identically in API and sync via one shared resolver** (spec §9 invariant).

## Data model (packages/db)
- Add `ydocState Bytes?` to `PageContent` (keep `doc` for back-compat; unused by the collab editor). Add `PageSnapshot` model (spec §5): `id, pageId, ydocSnapshot Bytes, label?, authorId?, createdAt` + index on pageId. Migration `page_ydoc_snapshots`.
- **Shared resolver:** new `packages/db/src/permissions.ts` → `resolvePageAccess(prisma, userId, pageId): Promise<{ canRead: boolean; canWrite: boolean } | null>` (null = page/user not found). Phase 3 rule: member of the page's workspace → `{canRead:true, canWrite:true}`; non-member → access denied. Export from db index. **Refactor the API** (`pages.service.ts` requirePageAccess) to use this same resolver so API and sync literally agree (Phase 6 extends it with `Permission` grants + roles → read/comment/edit/full).

## Sync server (apps/sync)
Use `@hocuspocus/server` extensions:
- `onAuthenticate({ token, documentName })`: verify the JWT (jsonwebtoken, `JWT_ACCESS_SECRET`) → userId (`sub`); parse pageId from `documentName` (`page:{id}`); call `resolvePageAccess`; reject (throw) if no read access; if `!canWrite` set `connection.readOnly = true`; return context `{ userId }`.
- Persistence via `@hocuspocus/extension-database`: `fetch` → load `PageContent.ydocState` for the page; `store` (debounced by Hocuspocus) → upsert `ydocState`. 
- Snapshot groundwork: throttled write of a `PageSnapshot` row on store (e.g. at most one per N minutes per page) — keep minimal but real.
- Keep `/health` + `/ready`. Add deps: `@hocuspocus/extension-database`, `jsonwebtoken`, `yjs`.
- Greenfield decision: Phase-2 `PageContent.doc` JSON is NOT migrated into Yjs (no production data); collab docs start fresh. Documented.

## Web (apps/web)
- Editor switches to collaborative: `@tiptap/extension-collaboration` + `@tiptap/extension-collaboration-cursor` bound to a `Y.Doc` provided by `@hocuspocus/provider` `HocuspocusProvider` connecting to `${VITE_COLLAB_URL}` (`/collab`) with `token` = access token and `name` = `page:{id}`. Drop StarterKit `history` (Collaboration supplies undo). `y-indexeddb` (`IndexeddbPersistence`) for offline; edits merge on reconnect. Awareness carries user name + a stable color from the auth store → remote carets.
- Remove the Phase-2 REST autosave for body content (Yjs persists via sync); title/icon/cover stay on REST. One provider per open page (clean up on close).
- Deps: `@hocuspocus/provider`, `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-cursor`, `yjs`, `y-indexeddb`, `y-prosemirror` (transitive via tiptap collab, add explicitly).

## Tests
- Unit: `resolvePageAccess` (member→rw, non-member→deny, missing→null) — Vitest; sync `onAuthenticate` logic (valid/invalid token, member/non-member, read-only when !canWrite) with a fake prisma + signed test JWT; web: awareness color/user derivation, provider URL/doc-name builder.
- Integration (Testcontainers Postgres): sync persistence round-trip — open a Yjs doc via a HocuspocusProvider (or direct server API) for `page:{id}`, apply an update, allow store, reconnect a fresh client, assert the content loads from `ydocState`; auth rejects an unauthenticated/non-member connection. Reuse the migration-apply pattern.
- E2E (Playwright, **two browser contexts**): both open the same page; type in both; assert each sees the other's text merged; assert a remote caret/presence indicator is visible. Offline: take one context offline (`context.setOffline(true)`), type, go back online, assert the edit syncs to the other. This is the gate.

## Tasks (subagent-driven)
- **T1 backend**: db migration (ydocState + PageSnapshot) + shared `resolvePageAccess` + refactor API pages authz to use it; sync server auth/authz + database persistence + snapshot groundwork; unit + Testcontainers integration. Keep `/health`+`/ready`.
- **T2 web**: collaborative Tiptap editor (Yjs + Hocuspocus provider + indexeddb + cursors); presence; remove REST body autosave; unit tests.
- **T3 e2e + gate**: two-context multiplayer + offline-reconnect Playwright test; ensure `docker compose up` healthy with the new migration; full DoD.

## Out of scope
Full block set/slash menu (Phase 4); synced blocks (Phase 8); fine-grained permission roles beyond membership (Phase 6).
