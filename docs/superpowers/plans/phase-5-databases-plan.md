# Phase 5 — Databases (Collections) Plan

**Goal:** Database pages; all property types; Cell storage; Table → Board → Calendar → Gallery views; per-view filters/sorts/grouping/visible-props; inline databases; linked views; relations; rollups; formulas; sub-items & dependencies; real-time cell updates via broadcast.

**Gate (spec §8):** a "Tasks" database works as a board grouped by status, a calendar by due date, and a filtered table ("my open tasks"), with a rollup over a linked "Projects" database and at least one working formula; a sub-task nests under a task; edits propagate live to a second browser.

**Two-mechanism rule (spec §4/§6):** structured data is **relational + optimistic mutation + event broadcast, LWW-per-cell** — NOT Yjs. The API publishes cell/row change events on a per-database websocket channel; clients patch their TanStack Query cache.

## Data model (spec §5; packages/db)
- **Database** — `pageId` (1:1 with a `Page` of type `database`), `defaultViewId?`, `subitemsEnabled bool`, `subitemsPropertyId?`.
- **Property** — `id, databaseId, name, type, config Json, order, isPrimary`. Types: `text, number, select, multi_select, status, date, person, checkbox, url, email, phone, files, relation, rollup, formula, created_time, created_by, last_edited_time, last_edited_by`.
- **Cell** — `(rowPageId, propertyId)` unique, `value Json`. Row identity = a `Page` of type `row` whose `parentId` = the database container page (or a parent row for sub-items).
- **RelationLink** — `(propertyId, fromRowId, toRowId)`; bidirectional; rollups aggregate over it.
- **View** — `id, databaseId, type (table|board|calendar|gallery), name, order, config Json` (visible/hidden props+order, filters AND/OR tree, sorts, group_by, date_property, gallery cover/size, page-size). Linked view: `databaseId` may belong to a different page.
Migration `databases`. Reuse Page (type `database`/`row`) from Phase 2.

## Engines (backend, pure + unit-tested)
- **Property value validation/normalization** per type (Zod-ish per type).
- **Filter engine**: evaluate an AND/OR tree of `{property, operator, value}` against a row's cells (operators per type: equals, contains, before/after, is_empty, checked, etc.).
- **Sort engine**: multi-key typed comparison.
- **Group engine**: group rows by a property (select/status/person/etc.).
- **Rollup engine**: given a relation property + target property + aggregation (count/sum/avg/min/max/range/show_original/percent_checked/…), compute over RelationLink.
- **Formula engine**: parse a formula expression (prop refs, +-*/, comparisons, if(), concat, number/date/string fns) to an AST and evaluate per row. Keep a bounded function set; pure + heavily unit-tested.
- Formulas/rollups computed **server-side and cached**; invalidated on dependency change.

## API (apps/api/src/databases)
- Database CRUD (create a database page; turn a page into a database), Property CRUD (add/reorder/configure/delete; isPrimary), View CRUD (+ per-view config), Row CRUD (rows are Pages of type `row`; create/delete/list under a database, sub-items via parentId), Cell get/set (LWW; updates last_edited_*; recompute dependent formulas/rollups), Relation link/unlink (maintains paired two-way), Rows query endpoint (apply a view's filters/sorts/grouping + pagination; returns rows + computed formula/rollup values). All authorized via the shared resolver (database/row pages live in a workspace).
- **Realtime**: a NestJS WebSocket gateway (socket.io, path under `/api` so Caddy proxies it, e.g. `/api/realtime`) with JWT-handshake auth + per-database access check; clients join `database:{id}` rooms; cell/row/property/view mutations emit change events to the room. LWW per cell.

## Web (apps/web/src/databases)
- Database page view with a view switcher; **Table** (virtualized rows, inline cell editors per type), **Board** (kanban grouped by a select/status prop, drag between columns = set cell), **Calendar** (by a date prop), **Gallery** (cards + cover). Filter/sort/group/visible-props UI per view. Property editors per type (incl. relation picker, rollup display, formula display, select/status options). Inline database block (the Phase-4 `databaseView` editor node) + linked database view node. Subscribe to `database:{id}` over socket.io → patch TanStack Query cache (live updates). Optimistic cell edits.

## Tests
- Unit (heavy): filter/sort/group/rollup/formula engines (many cases); property value validation; relation pairing.
- Integration (Testcontainers): database+property+view+row+cell CRUD; relation link maintains pair; rollup over a relation; a formula value; filtered/sorted/grouped rows query; sub-item nesting; authz (non-member 403). Realtime gateway: a cell mutation emits to the room (can test the gateway emit logic / a connected socket client).
- E2E (Playwright): build the gate scenario — Tasks DB (board by status, calendar by due date, filtered "my open tasks" table), a Projects DB linked via a relation with a rollup, one formula, a sub-task; edit a cell in one browser context and see it update in a second context (live broadcast).

## Tasks (subagent-driven; large — decompose)
- **T1 model + shared types**: Prisma models + migration; shared TS types/enums for property types, view types, filter/sort/group config, aggregations; Zod for API inputs. (foundation)
- **T2 engines**: filter, sort, group, rollup, formula (parser+evaluator), property-value validation — pure modules in apps/api (or a package) + exhaustive unit tests.
- **T3 API CRUD + query**: databases/properties/views/rows/cells/relations services + controllers; rows-query applying view config + computed formula/rollup; authz; integration tests.
- **T4 realtime gateway**: socket.io gateway (auth + per-db rooms + emit on mutation); wire emits into T3 mutations; Caddy route; integration/unit.
- **T5 web views**: table/board/calendar/gallery + property editors + filter/sort/group UI + inline/linked db nodes + live subscription; unit tests.
- **T6 e2e + gate**: the full gate scenario incl. live propagation to a 2nd browser; docker boot healthy; full DoD.

## Out of scope
Comments/permissions UI beyond membership (Phase 6); search over cells (Phase 7 index); templates (out of v1).
