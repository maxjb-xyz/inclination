import type { PageType } from "@inclination/shared";

export interface Workspace {
  id: string;
  name: string;
  icon: string | null;
  settings: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface Page {
  id: string;
  workspaceId: string;
  parentId: string | null;
  type: PageType;
  title: string;
  icon: string | null;
  cover: string | null;
  sortKey: string;
  archivedAt: string | null;
  createdById: string;
  editedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PageWithBreadcrumbs {
  page: Page;
  breadcrumbs: Page[];
}

export interface PageContent {
  doc: Record<string, unknown>;
  updatedAt: string | null;
}

/** A page node with its children, built from the flat list. */
export interface PageNode extends Page {
  children: PageNode[];
}

/** A workspace member surfaced by the `@`-mention search. */
export interface MentionableUser {
  id: string;
  displayName: string;
  email: string;
  kind: "user";
}

/** A page surfaced by the `@`/`[[` search. */
export interface MentionablePage {
  id: string;
  title: string;
  icon: string | null;
  kind: "page";
}

/** Result of `GET /workspaces/:wsId/search/mentionable`. */
export interface MentionableResult {
  users: MentionableUser[];
  pages: MentionablePage[];
}

/** A backlink entry from `GET /pages/:id/backlinks`. */
export interface Backlink {
  id: string;
  title: string;
  icon: string | null;
}

/** A full-text search hit from `GET /workspaces/:wsId/search?q=`. */
export interface SearchResult {
  pageId: string;
  title: string;
  /** Snippet with matches wrapped in `[[` … `]]` highlight markers. */
  snippet: string;
  rank: number;
}

/** Response of `POST /workspaces/:wsId/uploads/presign`. */
export interface PresignResult {
  /** Presigned PUT URL — client uploads bytes here with the same Content-Type. */
  uploadUrl: string;
  objectKey: string;
  attachmentId: string;
  /** Stable path the served URL can be resolved from. */
  downloadPath: string;
}

/** Response of `GET /attachments/:id`. */
export interface AttachmentUrl {
  url: string;
}

/** A version-history entry from `GET /pages/:id/snapshots`. */
export interface Snapshot {
  id: string;
  label: string | null;
  authorId: string | null;
  createdAt: string;
}

/** A snapshot's preview content from `GET /pages/:id/snapshots/:snapId`. */
export interface SnapshotContent {
  text: string;
  decoded: boolean;
  doc: Record<string, unknown> | null;
}

// ── Phase 8: publishing / import-export / synced blocks ─────────────

/** Current publish settings for a page (`GET /pages/:id/public-share`); null if never published. */
export interface PublicShareSettings {
  slug: string;
  published: boolean;
  includeSubpages: boolean;
  allowDuplicate: boolean;
  title: string;
}

/** Public (logged-out) read payload from `GET /api/public/:slug`. */
export interface PublicPage {
  title: string;
  html: string;
  includeSubpages: boolean;
  allowDuplicate: boolean;
  subpages?: { slug: string; title: string }[];
}

/** Result of `GET /pages/:id/export/markdown`. */
export interface MarkdownExport {
  filename: string;
  markdown: string;
}

/** The created page tree from `POST /workspaces/:wsId/import/markdown`. */
export interface ImportedTree {
  id: string;
  title: string;
  children: ImportedTree[];
}

// ── Phase 9: favorites / recents ────────────────────────────────────

/** A favorited page from `GET /api/favorites`. */
export interface Favorite {
  pageId: string;
  title: string;
  icon: string | null;
  order: number;
}

/** A recently-visited page from `GET /api/recents`. */
export interface Recent {
  pageId: string;
  title: string;
  icon: string | null;
  visitedAt: string;
}
