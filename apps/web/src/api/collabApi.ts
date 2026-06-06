import type {
  CreateCommentInput,
  ShareInviteInput,
  UpsertPermissionInput,
} from "@inclination/shared";
import type { ApiClient } from "./apiClient";
import type {
  CommentWithAuthor,
  NotificationItem,
  PageAccess,
  PermissionGrant,
  ResolveResult,
  ShareInviteResult,
  UnreadCount,
} from "./collabTypes";

/**
 * Phase 6 T3 — REST surface for sharing/permissions, comments and
 * notifications. Parameterised by an {@link ApiClient} for unit-testing against
 * a mocked client, matching the `createPagesApi` / `createDbApi` pattern.
 */
export function createCollabApi(client: ApiClient) {
  return {
    // ── Page access (capability gating) ───────────────────────
    getAccess: (pageId: string) => client.get<PageAccess>(`/pages/${pageId}/access`),

    // ── Sharing / permissions ─────────────────────────────────
    listPermissions: (pageId: string) =>
      client.get<PermissionGrant[]>(`/pages/${pageId}/permissions`),
    upsertPermission: (pageId: string, input: UpsertPermissionInput) =>
      client.put<PermissionGrant>(`/pages/${pageId}/permissions`, input),
    removePermission: (pageId: string, permId: string) =>
      client.del<{ deleted: number; id: string }>(`/pages/${pageId}/permissions/${permId}`),
    shareInvite: (pageId: string, input: ShareInviteInput) =>
      client.post<ShareInviteResult>(`/pages/${pageId}/share-invite`, input),

    // ── Comments ──────────────────────────────────────────────
    listComments: (pageId: string) =>
      client.get<CommentWithAuthor[]>(`/pages/${pageId}/comments`),
    createComment: (pageId: string, input: CreateCommentInput) =>
      client.post<CommentWithAuthor>(`/pages/${pageId}/comments`, input),
    resolveThread: (commentId: string) =>
      client.post<ResolveResult>(`/comments/${commentId}/resolve`),
    unresolveThread: (commentId: string) =>
      client.post<ResolveResult>(`/comments/${commentId}/unresolve`),
    deleteComment: (commentId: string) =>
      client.del<{ deleted: number; id: string }>(`/comments/${commentId}`),

    // ── Notifications ─────────────────────────────────────────
    listNotifications: () => client.get<NotificationItem[]>(`/notifications`),
    unreadCount: () => client.get<UnreadCount>(`/notifications/unread-count`),
    markRead: (id: string) => client.post<NotificationItem>(`/notifications/${id}/read`),
    markAllRead: () => client.post<{ updated: number }>(`/notifications/read-all`),
  };
}

export type CollabApi = ReturnType<typeof createCollabApi>;
