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
