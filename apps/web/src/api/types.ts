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
