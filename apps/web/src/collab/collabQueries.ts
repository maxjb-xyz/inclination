import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  CreateCommentInput,
  ShareInviteInput,
  UpsertPermissionInput,
} from "@inclination/shared";
import { apiClient } from "../api/apiClient";
import { createCollabApi } from "../api/collabApi";

const api = createCollabApi(apiClient);

export const collabKeys = {
  access: (pageId: string) => ["page", pageId, "access"] as const,
  permissions: (pageId: string) => ["page", pageId, "permissions"] as const,
  comments: (pageId: string) => ["page", pageId, "comments"] as const,
  notifications: ["notifications"] as const,
  unread: ["notifications", "unread"] as const,
};

// ── Access (capability gating) ──────────────────────────────────
export function usePageAccess(pageId: string | null) {
  return useQuery({
    queryKey: pageId ? collabKeys.access(pageId) : ["page", "none", "access"],
    queryFn: () => api.getAccess(pageId as string),
    enabled: Boolean(pageId),
  });
}

// ── Sharing / permissions ───────────────────────────────────────
export function usePermissions(pageId: string | null, enabled = true) {
  return useQuery({
    queryKey: pageId ? collabKeys.permissions(pageId) : ["page", "none", "permissions"],
    queryFn: () => api.listPermissions(pageId as string),
    enabled: Boolean(pageId) && enabled,
  });
}

function invalidatePermissions(qc: QueryClient, pageId: string): void {
  void qc.invalidateQueries({ queryKey: collabKeys.permissions(pageId) });
}

export function useUpsertPermission(pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertPermissionInput) => api.upsertPermission(pageId, input),
    onSuccess: () => invalidatePermissions(qc, pageId),
  });
}

export function useRemovePermission(pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (permId: string) => api.removePermission(pageId, permId),
    onSuccess: () => invalidatePermissions(qc, pageId),
  });
}

export function useShareInvite(pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ShareInviteInput) => api.shareInvite(pageId, input),
    onSuccess: () => invalidatePermissions(qc, pageId),
  });
}

// ── Comments ────────────────────────────────────────────────────
export function useComments(pageId: string | null, enabled = true) {
  return useQuery({
    queryKey: pageId ? collabKeys.comments(pageId) : ["page", "none", "comments"],
    queryFn: () => api.listComments(pageId as string),
    enabled: Boolean(pageId) && enabled,
  });
}

function invalidateComments(qc: QueryClient, pageId: string): void {
  void qc.invalidateQueries({ queryKey: collabKeys.comments(pageId) });
}

export function useCreateComment(pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCommentInput) => api.createComment(pageId, input),
    onSuccess: () => invalidateComments(qc, pageId),
  });
}

export function useResolveThread(pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, resolved }: { commentId: string; resolved: boolean }) =>
      resolved ? api.unresolveThread(commentId) : api.resolveThread(commentId),
    onSuccess: () => invalidateComments(qc, pageId),
  });
}

export function useDeleteComment(pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => api.deleteComment(commentId),
    onSuccess: () => invalidateComments(qc, pageId),
  });
}

// ── Notifications ───────────────────────────────────────────────
export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: collabKeys.notifications,
    queryFn: () => api.listNotifications(),
    enabled,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: collabKeys.unread,
    queryFn: () => api.unreadCount(),
    // Poll so the badge stays roughly current without a socket.
    refetchInterval: 30_000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.markRead(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: collabKeys.notifications });
      void qc.invalidateQueries({ queryKey: collabKeys.unread });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.markAllRead(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: collabKeys.notifications });
      void qc.invalidateQueries({ queryKey: collabKeys.unread });
    },
  });
}
