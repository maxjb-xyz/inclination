# UI Overhaul Handoff — make Inclination look like Notion

**Audience:** a design-focused agent taking the web app from "functional but ugly" to a polished, Notion-grade UI **end to end**.
**Scope:** `apps/web` only. Every backend gate already passes; do **not** touch backend/editor-package logic — this is purely presentation + a thin component-primitives layer.
**Status of the app:** feature-complete (10 phases: auth, real-time editor, databases, comments/permissions, search/files/versions, publishing/synced blocks). It works; it just looks like raw HTML. The user is literally stuck on the sign-in screen because the auth form is unstyled `<input>`s.

> Recommended companion skill: invoke `frontend-design` for the aesthetic execution. This doc is the brief + the guardrails.

---

## 1. Mission & definition of done

Deliver a cohesive, calm, modern **Notion-like** interface across every surface, in **both light and dark mode**, without breaking a single test or feature.

**Done when:**
- Every screen below is visually redesigned to a consistent design system (tokens, type scale, spacing, components).
- Light **and** dark themes both look intentional (not just inverted).
- Responsive: usable from ~360px (mobile) to wide desktop; the sidebar already collapses — make it feel native.
- `pnpm --filter @inclination/web run typecheck`, `... run test`, `... run build`, and `pnpm lint` are all green.
- The **test contract in §3 is fully preserved** (the e2e suite in `e2e/tests/*` and the web unit tests in `apps/web/test/*` still pass — they assert on `data-testid`, `aria-label`, roles, and visible text).
- The first impression — **the sign-in screen (§7)** — looks professional. Start here.

**Out of scope:** new features, backend changes, editor behavior, renaming/removing any `data-testid` / `aria-label` / role / button text the tests use.

---

## 2. Current state (what you're starting from)

- **Stack:** React 19 + Vite + TypeScript. State: Zustand (`src/theme/themeStore.ts`, `src/auth/authStore.ts`). Data: TanStack Query. Editor: Tiptap/ProseMirror. DnD: `@dnd-kit`. **No UI library, no CSS framework, no icon set.**
- **All styling lives in one file:** `apps/web/src/app.css` (~1,734 lines) plus a few inline `style={{…}}` props. It already defines **light/dark theme tokens** via CSS custom properties on `:root` / `[data-theme="dark"]` (see top of `app.css`). Components reference `var(--bg)`, `var(--text)`, `var(--accent)`, etc., so theming works — but the visual design is utilitarian.
- **Existing tokens** (keep the names, refine the values + add more): `--bg, --bg-elevated, --bg-sidebar, --bg-subtle, --bg-hover, --bg-active, --text, --text-strong, --muted, --border, --border-strong, --accent, --accent-contrast, --accent-soft, --scrim, --shadow, --shadow-strong, --code-bg, --code-fg, --highlight, --danger, --success`.
- **The auth screen** (`src/auth/AuthPanel.tsx`, rendered by `src/App.tsx` inside `<main className="auth-shell">`) is raw: unstyled `<input aria-label="Email">`, `<button>Sign in</button>`, a `role="tablist"` of two text buttons. This is priority #1.
- **Theme is applied** to `<html data-theme>` by `useTheme()` in `App.tsx`; a `ThemeToggle` (`data-testid="theme-toggle"`) is already in the topbar. Keep it; make it pretty (sun/moon).

---

## 3. HARD CONSTRAINTS — the test contract (do not break)

A redesign breaks tests if it changes how elements are found. **Preserve all of the following.** When in doubt, restyle the existing element rather than replace it; keep these attributes on whatever renders.

**3a. Accessible names the auth + form tests use (`getByLabelText` / `getByRole`):**
- Inputs must keep their `aria-label`: `"Email"`, `"Password"`, `"Display name"` (auth); `"Slug"`, `"Public URL"`, `"Include subpages"`, `"Allow duplicate"`, `"Invite by email"`, `"Comment text"`, `"Page title"`, `"Role for <subject>"` and similar across dialogs/editor (grep `aria-label=` before changing markup).
- Forms keep `aria-label="Register"` / `"Log in"`.
- Button visible text the tests click: **`Sign in`**, `Create account`, `Log in`, `Register`, `Save`/`Restore`/`Invite`/`Remove …`, `New page`, `Add subpage`, `Mark all read`, etc. You may add icons next to the text, but keep the accessible name (icon-only buttons must get an `aria-label` equal to the old text).
- Roles/messages: validation errors render with `role="alert"`; the "check your email" success uses `role="status"`; keep these.

**3b. Every `data-testid` must survive** (full list — keep each on the element that currently has it):
`current-user, theme-toggle, sidebar-toggle, sidebar-scrim, open-command-palette, open-shortcuts, shortcuts-help, page-row, import-md-input, favorites-section, favorite-item, recents-section, recent-item, trash-row, page-actions, toggle-comments, toggle-history, export-markdown, open-publish, open-share, presence-indicator, favorite-button, inline-comment-button, inline-comment-composer, editor, command-palette, command-palette-input, command-palette-favorites-group, command-palette-favorite, command-palette-loading, command-palette-result, command-palette-snippet, snippet-highlight, command-palette-empty, slash-menu, block-handle, block-menu, mention-menu, mention-user, mention-page, page-link, equation-block, database-node, database-node-create, media-image, media-image-upload, media-image-uploading, media-image-error, media-image-blocked, synced-block, synced-block-create, synced-block-editor, share-dialog, share-list, share-row, comments-panel, comment-thread, comment, comment-composer, comment-mention-menu, notifications-bell, notifications-badge, notifications-panel, notification-item, publish-dialog, publish-state, public-url, copy-public-url, publish-button, unpublish-button, public-page, public-title, public-body, public-subpages, version-panel, version-save, version-close, version-empty, version-item, version-item-select, version-restore, version-preview, backlinks-panel, db-view, db-view-switcher, db-add-view, db-view-controls, db-filter, db-filter-row, db-add-filter, db-sort, db-groupby, db-visible-props, db-table, db-add-property, db-add-row, db-add-property-form, db-add-property-submit, db-options-editor, db-edit-property-form, db-edit-property-save, db-board, db-calendar, db-gallery, cell-editor-readonly, cell-editor-multi_select, cell-editor-date, cell-editor-files`.

**3c. Don't touch the editor's internal DOM.** Tiptap renders ProseMirror; style it via `.ProseMirror` and the custom-node selectors (`[data-type="callout"]`, `.collaboration-cursor__caret`, etc.) — don't change node markup in `packages/editor` or the NodeViews' structure/testids.

**3d. After every surface, run the web unit tests** (`apps/web/test/*`, RTL) — they render components and assert on the above. Run the full Playwright suite (per the project's `rtk proxy pnpm --filter @inclination/e2e exec playwright test`) once at the end against a built stack.

---

## 4. Design language (the Notion feel)

Aim for **calm, content-first, low-chrome**. Specifics:

- **Typography:** a clean system/sans stack for UI; a slightly larger, comfortable reading size for page content. Notion uses ~16px body, generous line-height (~1.5), tight-but-legible headings. Define a type scale (see §5). Use one accent font weight bump for headings, not many.
- **Color:** mostly **neutral greys + lots of white space**; a single restrained accent (blue is fine — keep `--accent`) used sparingly for primary actions, links, selection. Avoid heavy borders; prefer subtle backgrounds (`--bg-hover`) and hairline `--border`. Dark mode = warm-neutral charcoals (the current `#1a1a1a` family), not pure black.
- **Density & spacing:** roomy. Consistent 4px-based spacing scale. Page content centered with a **max content width (~ 700–900px)** and big top padding, like a Notion doc.
- **Radius & shadow:** small radii (6–8px) for inputs/buttons/cards; soft, low shadows for popovers/dialogs (not harsh). Menus float with a faint border + soft shadow.
- **Signature interactions:** controls **reveal on hover** (e.g. the page block handle, row actions, "+"/"⋮" buttons appear on hover, hidden otherwise); the **slash menu** and **mention/command palettes** are clean floating cards with keyboard nav + a highlighted active row; the **sidebar** is a quiet grey rail with hover-highlighted rows, collapse chevrons, and section headers ("Favorites", "Recent", "Private"). Selection/active states use `--bg-active` + a subtle left accent or weight change.
- **Motion:** quick, subtle (120–180ms ease) for hovers, menu open, theme switch. No bouncy/slow animations.
- **Icons:** Notion leans on simple line icons + emoji. There is **no icon set today** — add **`lucide-react`** (tree-shakeable line icons) and use it consistently (chevrons, search, settings, share, comment, history, star, sun/moon, plus, trash, drag-grip, etc.). Page icons can stay emoji.
- **Empty/loading/error states:** every list/panel needs a designed empty state (icon + one line + a primary action) and a skeleton/spinner. No bare "No results".

Study Notion's: sidebar, the page header (icon + title + hover actions), the slash menu, the share dialog, the database table/board, and the top-of-page "Add icon / Add cover" affordances.

---

## 5. Design tokens to establish (extend `app.css`)

Refine the existing color tokens (warm neutrals, softer borders, a calmer accent) and **add** a system layer so components are consistent. Put these at the top of `app.css` (or a new `src/styles/tokens.css` imported first). Use in both `:root`/light and `[data-theme="dark"]`.

```
/* spacing (4px base) */ --space-1..--space-8 : 4,8,12,16,24,32,48,64 px
/* radius */            --radius-sm/md/lg     : 6 / 8 / 12 px
/* type */              --font-ui, --font-content (system stack), --font-mono
                        --text-xs/sm/base/lg/xl/2xl/3xl  (12/13/15/18/22/28/34)
                        --leading-tight/normal/relaxed
/* elevation */         --shadow-sm/md/lg (layer popovers/dialogs)
/* layout */            --content-max: 820px;  --sidebar-w: 260px;  --topbar-h: 44px
/* motion */            --ease: cubic-bezier(.2,0,0,1);  --dur: 140ms
/* focus */             --focus-ring: 0 0 0 2px var(--accent-soft), 0 0 0 4px var(--accent)
```
Keep the existing semantic color vars; just retune values for a more Notion-like, less saturated palette and ensure AA contrast in both themes.

---

## 6. Component primitives to build (no library)

Create a small, reusable layer (e.g. `src/ui/`) so every screen is consistent — plain React + CSS classes, accessible, theme-aware. Minimum set:

- **Button** — variants: `primary`, `secondary`/default, `ghost`, `danger`; sizes sm/md; loading + disabled states; optional leading icon. (Used everywhere — replace bare `<button>`s but keep their text/testids.)
- **Input / Field** — labeled text input with the label, helper text, error state (`role="alert"`), focus ring; keep `aria-label`. A **Field** wrapper composes label+input+error.
- **Segmented control / Tabs** — for the Login/Register switch and DB view switcher (keep `aria-pressed`, testids).
- **Dialog/Modal** — centered card, scrim (`--scrim`), focus trap, Esc to close, header/body/footer; reuse for Share, Publish, Shortcuts, Property editor. (Keep their testids/roles.)
- **Menu/Popover** — floating card for slash menu, mention/command results, block menu, view controls (keyboard nav, active row highlight).
- **Card / Panel** — for the auth card, comments/version/backlinks side panels, gallery cards.
- **Avatar** (initials + the existing presence color), **Badge/Chip** (select/status/relation cells, notification count), **Tooltip**, **Toast** (for "Copied", errors), **Spinner/Skeleton**, **EmptyState**, **IconButton** (icon-only, must carry `aria-label`).

Don't over-engineer; these are thin styled wrappers. Keep accessibility (labels, roles, focus, keyboard).

---

## 7. PRIORITY #1 — the auth screen (do this first, fully)

File: `src/auth/AuthPanel.tsx` (+ the `auth-shell` wrapper in `src/App.tsx`). Today it's raw inputs centered in a 480px column with an `<h1>` and a tagline.

**Target:** a polished centered **auth card** on a calm full-height background (subtle gradient or flat `--bg`), brand at top, a segmented **Sign in / Register** control, clean labeled fields, a full-width **primary** button with a loading state, inline validation (`role="alert"`), and the post-register **"Check your email"** confirmation (`role="status"`) as a friendly success state. Add a small footer (e.g. "Self-hosted · open source"). Make it look like a product, not a form.

```
        ┌───────────────────────────────────────┐
        │              ◆  Inclination            │   ← brand mark + name
        │   Your self-hosted workspace           │   ← subtle tagline
        │                                        │
        │   ┌───────────┬───────────┐            │   ← segmented control
        │   │  Sign in  │  Register │            │     (aria-pressed kept)
        │   └───────────┴───────────┘            │
        │                                        │
        │   Email                                │   ← Field: label + input
        │   [ you@example.com            ]       │     (aria-label="Email")
        │   Password                             │
        │   [ ••••••••••••              👁 ]     │     (aria-label="Password")
        │   ⚠ Invalid credentials                │   ← role="alert", only on error
        │                                        │
        │   [        Sign in  →         ]        │   ← Button primary, full width,
        │                                        │     spinner while submitting
        │   ─────────  or  ─────────             │   ← (optional) OIDC button if
        │   [   Continue with SSO   ]            │     OIDC is configured*
        └───────────────────────────────────────┘
```
Constraints: keep `aria-label="Log in"`/`"Register"` forms, the `Sign in`/`Create account` button text, input `aria-label`s, and `role="alert"`/`role="status"`. The Register success state ("Check your email to verify your account.") must remain reachable and keep `role="status"`.

\*OIDC: `GET /api/auth/oidc/login` 302s to the provider; only show the SSO button when OIDC is enabled — you can probe via a small check or just always render and let the click flow (don't block on this; it's a nice-to-have for the auth screen).

Both light and dark must look great. This screen is the user's blocker — nail it before moving on.

---

## 8. Screen-by-screen plan (priority order)

Work top-down; commit per surface; run web tests after each. Each item lists its file(s).

1. **Auth** — `auth/AuthPanel.tsx`, `App.tsx` auth branch. (§7) ✦ first
2. **App shell** — `App.tsx` topbar (brand, spacer, `ThemeToggle`, `current-user`, Sign out → make a proper user menu/avatar) + `pages/Workspace.tsx` (the `app-shell`, sidebar layout, `sidebar-toggle`/`sidebar-scrim`, responsive overlay, `open-command-palette`, `open-shortcuts`, `NotificationsBell`). Give it the quiet two-pane Notion frame.
3. **Sidebar** — `pages/Sidebar.tsx` (page tree rows `page-row`, hover actions, new-page/import), `pages/SidebarFavorites.tsx` (Favorites/Recent sections), `pages/TrashView.tsx`. Section headers, collapse chevrons, hover reveal, drag affordance (DnD already wired — style the handle/drop indicator).
4. **Page + editor surface** — `pages/PageView.tsx` (page header: icon/title/cover, `page-actions` row with comments/history/export/publish/share, `presence-indicator`, `favorite-button`, breadcrumbs, `BacklinksPanel`) and `pages/Editor.tsx` + `app.css` `.ProseMirror` styles (block typography, callouts, code via highlight.js theme, KaTeX, toggle/columns/quote, the hover `block-handle`/`block-menu`, the `slash-menu`, `inline-comment-button`). Center content to `--content-max`. This is the heart of the app — make writing feel like Notion.
5. **Command palette & menus** — `pages/CommandPalette.tsx`, `editor/SlashMenu.tsx`, `editor/MentionMenu.tsx`, `editor/BlockHandle.tsx`, `shortcuts/ShortcutsHelp.tsx`. Floating cards, keyboard active-row highlight, snippet highlights (`snippet-highlight`).
6. **Dialogs & side panels** — `collab/ShareDialog.tsx`, `publish/PublishDialog.tsx`, `collab/CommentsPanel.tsx` + `collab/CommentComposer.tsx`, `pages/VersionHistoryPanel.tsx`, `collab/NotificationsBell.tsx` (bell + badge + dropdown). Use the Dialog/Panel/Menu primitives.
7. **Databases** — `databases/DatabaseView.tsx` (view switcher tabs `db-view-switcher`, `db-add-view`), `TableView.tsx`, `BoardView.tsx` (kanban columns + dnd cards), `CalendarView.tsx`, `GalleryView.tsx`, `CellEditor.tsx` (per-type cell editors + chips), `PropertyEditor.tsx`, `ViewControls.tsx` (filter/sort/group/visible-props popovers). This is large; make the **table** crisp (sticky header, hairline grid, hover row, inline edit) and the **board** clean (column headers with counts, draggable cards).
8. **Public page** — `public/PublicPageView.tsx` (`public-page/title/body/subpages`). It renders sanitized HTML into `.public-body` — style as a clean reading page (typography, max width, light/dark). This is the logged-out first impression for shared links.
9. **Editor media/nodes** — `editor/ImageView.tsx`, `MediaView.tsx`, `EquationView.tsx`, `DatabaseNodeView.tsx`, `SyncedBlockView.tsx`, `MentionView.tsx`, `PageLinkView.tsx`. Style the URL/upload affordances, captions, blocked-URL placeholder, synced-block frame, mention/pagelink chips.
10. **Global states & responsive** — empty states, skeletons, toasts, error toasts; verify every surface at mobile/tablet/desktop; the theme toggle as sun/moon with smooth transition.

---

## 9. Workflow & verification

- **Add `lucide-react`** to `apps/web` deps first (`pnpm --filter @inclination/web add lucide-react`); rebuild lockfile.
- Build the **tokens + primitives** (§5–6), then go screen-by-screen (§8). Prefer restyling existing elements over restructuring markup.
- After each surface: `pnpm --filter @inclination/web run typecheck && pnpm --filter @inclination/web run test`. Fix any test that breaks **by restoring the contract** (testid/aria/text), not by editing the test's intent.
- Before finishing: `pnpm --filter @inclination/web run build`, `pnpm lint`, and a full visual pass in **both themes**. Then run the e2e suite once against a built stack (see project README / `rtk proxy pnpm --filter @inclination/e2e exec playwright test`) to confirm nothing regressed.
- Commit per surface with conventional commits; keep `apps/web` the only touched area.

## 10. Gotchas
- The web app uses **CSS variables for theming** — never hardcode a color that won't adapt to dark mode; add a token instead.
- `app.css` is one big file — fine to split into `src/styles/*.css` imported from `app.css`/`main.tsx`, but keep one source of truth for tokens.
- The **public page** and the **collaborative editor** render HTML/ProseMirror you don't fully control — style via container classes (`.public-body`, `.ProseMirror`) and the documented node selectors.
- KaTeX (`katex/dist/katex.min.css`) and highlight.js themes are already imported in the editor; pick/adjust a code theme that matches dark/light.
- Don't add a heavyweight CSS framework (Tailwind/MUI) — it'd fight the existing CSS-variable system and bloat the bundle (already ~flagged for size). Plain CSS + the primitives is the right call. (If you strongly prefer Tailwind, that's a bigger migration — get sign-off first.)

---

**TL;DR:** Build tokens + a small primitives layer, then redesign every surface in §8 to a calm Notion aesthetic in light + dark — **starting with the sign-in card (§7)** — while preserving every `data-testid`, `aria-label`, role, and button text in §3 so the test suite stays green.
