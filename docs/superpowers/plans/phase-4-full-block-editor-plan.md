# Phase 4 — Full Block Editor Plan

**Goal:** All block types (§7), slash menu, drag handle + block menu, Markdown shortcuts, nesting, inline `@`-mentions (users + pages), page links, **backlinks**.

**Gate (spec §8):** every block type can be inserted via the slash menu and round-trips through reload + collaboration; mentioning a page creates a working backlink.

## Block set (spec §7) — all must insert via slash menu + round-trip
Text/structure: paragraph, H1–H3, bulleted list, numbered list, toggle list, to-do, quote, callout, divider, columns, table of contents.
Code/math: code block (syntax highlight via lowlight), inline code, equation (KaTeX).
Media/embeds: image, file, video, bookmark/link preview, generic embed (iframe). **Phase 4 = URL-based** (paste/enter a URL); actual MinIO upload is Phase 7.
Tables: simple inline table (distinct from databases).
References: page link, `@`-mention (user/page). (Inline database / linked db view → Phase 5 nodes; synced block → Phase 8 — out of scope here.)

## packages/editor (becomes the real shared extension package)
Export a function `buildExtensions({ collaboration?, mentionSuggestion?, pageLinkSuggestion? })` returning the Tiptap extension array, plus custom nodes/marks. Use StarterKit (history off when collab) + community/custom extensions:
- Lists/todo/toggle/quote/code/table via Tiptap official extensions; `lowlight` for code highlighting; `katex` for the equation node; custom NodeViews for callout, toggle, columns, equation, media (image/file/video/bookmark/embed), pageLink, mention, divider, TOC.
- Markdown input rules (headings `#`, lists `-`/`1.`, quote `>`, code ``` ``` ```, todo `[]`, divider `---`).
- `mention` node (`{kind:'user'|'page', id, label}`) + `pageLink` node (`{pageId,label}`) with suggestion configs injected by the web app (so the package stays framework-light).
- Keep extensions ESM; the web app (Vite) consumes them. Svelte/none — React NodeViews live in the web app or use Tiptap's ReactNodeViewRenderer in web; the package exports the schema/extensions and the web wires React node views where needed. (Pragmatic: package exports plain ProseMirror/Tiptap nodes + the web supplies React renderers for the few that need rich UI.)
- Deps: `@tiptap/*` extension packages, `lowlight`, `katex`, `@tiptap/extension-*`.

## API (apps/api)
- **Backlinks:** `PageReference` model (`id, fromPageId, toPageId, createdAt, @@unique([fromPageId,toPageId])`, indexes). Endpoints: `PUT /api/pages/:id/references` (replace the set of page-ids this page references — called by the web when pageLink/page-mention nodes change), `GET /api/pages/:id/backlinks` (pages that reference :id, with title/icon). Authorized via the shared resolver. Migration `page_references`.
- **Mention/link search:** `GET /api/workspaces/:wsId/search/mentionable?q=` → matching workspace members (users) + pages (title) for the `@`/link autocomplete. Authorized to members.

## Web (apps/web)
- Wire the full extension set into the collaborative editor (Collaboration-compatible). Slash menu (`/`) via a suggestion plugin listing all block types → inserts the node. Drag handle + block menu (`@tiptap/extension-drag-handle-react` or a custom global drag handle) with duplicate/delete/turn-into/move. Markdown shortcuts on. Arbitrary nesting.
- `@`-mention suggestion → calls the mentionable search; inserting a page-mention or a page-link writes the node.
- On document change (debounced), compute the set of referenced pageIds from the editor and `PUT /pages/:id/references`; render a **Backlinks** panel on each page (`GET /pages/:id/backlinks`). Clicking a pageLink/backlink navigates.
- KaTeX + lowlight CSS imported.

## Tests
- Unit (editor pkg, Vitest): extension list builds; markdown input rule → node; pageLink/mention node attrs serialize; reference-extraction util (doc → set of pageIds).
- Unit (web): slash-menu items list; mention/search client; backlinks panel renders.
- Integration (Testcontainers): PUT references replaces the set; GET backlinks returns referencing pages; mentionable search returns members + pages; authz (non-member 403).
- E2E (Playwright): open a page, insert each block type via the slash menu (assert the node renders), reload + (optionally second context) assert it persists/collab-syncs; create page B, in page A insert a page-mention/link to B, then open B and assert A shows as a backlink. This is the gate.

## Tasks (subagent-driven)
- **T1 backend**: PageReference model + migration; references PUT + backlinks GET + mentionable search; authz via shared resolver; unit + integration. (independent — do first)
- **T2 editor**: packages/editor full extension set + custom nodes + markdown rules + slash-menu item registry + reference-extraction util; unit tests. Wire into apps/web collaborative editor (slash menu, drag handle/block menu, all blocks rendering). web unit tests.
- **T3 mentions/links/backlinks (web)**: `@`-mention + page-link suggestions (using T1 search), reference syncing on change, Backlinks panel + navigation; web tests.
- **T4 e2e + gate**: slash-menu insert-all-blocks + round-trip + backlink e2e; `docker compose up` healthy; full DoD.

## Out of scope
Inline/linked databases (Phase 5); file/image UPLOAD via MinIO (Phase 7 — Phase 4 media blocks take URLs); synced blocks (Phase 8); comments (Phase 6).
