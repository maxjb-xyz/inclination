import type { BlockAnchor, PermissionRole } from "@inclination/shared";

/** The caller's resolved capabilities for a page (GET /pages/:id/access). */
export interface PageAccess {
  role: PermissionRole;
  canRead: boolean;
  canComment: boolean;
  canWrite: boolean;
  canShare: boolean;
}

/** Subject info attached to a permission grant in the list response. */
export type GrantSubject =
  | { kind: "user"; id: string; displayName: string; email: string; avatarUrl: string | null }
  | { kind: "workspace"; id: string; name: string }
  | { kind: "public" }
  | null;

/** A permission grant on a page (GET /pages/:id/permissions). */
export interface PermissionGrant {
  id: string;
  pageId: string;
  subjectType: "user" | "workspace" | "public";
  subjectId: string | null;
  role: PermissionRole;
  createdAt: string;
  subject?: GrantSubject;
}

/** Result of POST /pages/:id/share-invite. */
export type ShareInviteResult =
  | { kind: "granted"; userId: string; permissionId: string; role: PermissionRole; guest: boolean }
  | { kind: "invited"; email: string };

/** A comment author (subset of the user). */
export interface CommentAuthor {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

/** A comment with its author, from GET /pages/:id/comments. */
export interface CommentWithAuthor {
  id: string;
  pageId: string;
  blockAnchor: BlockAnchor | null;
  threadId: string;
  parentCommentId: string | null;
  authorId: string;
  body: Record<string, unknown>;
  resolvedAt: string | null;
  createdAt: string;
  author: CommentAuthor | null;
}

export interface ResolveResult {
  resolved?: number;
  unresolved?: number;
  threadId: string;
  resolvedAt?: string;
}

/** A notification (GET /notifications). */
export interface NotificationItem {
  id: string;
  recipientId: string;
  type: string;
  sourceRef: { pageId?: string; commentId?: string; threadId?: string; [k: string]: unknown };
  readAt: string | null;
  createdAt: string;
  preview: { pageTitle: string } | null;
}

export interface UnreadCount {
  count: number;
}
