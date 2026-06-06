import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { CreatePageInput, MovePageInput, UpdatePageInput } from "@inclination/shared";
import { apiClient } from "../api/apiClient";
import { createPagesApi } from "../api/pagesApi";
import { createSearchApi } from "../api/searchApi";

const api = createPagesApi(apiClient);
const searchApi = createSearchApi(apiClient);

export const queryKeys = {
  workspaces: ["workspaces"] as const,
  tree: (wsId: string) => ["pages", wsId, "tree"] as const,
  trash: (wsId: string) => ["pages", wsId, "trash"] as const,
  page: (id: string) => ["page", id] as const,
  content: (id: string) => ["page", id, "content"] as const,
  backlinks: (id: string) => ["page", id, "backlinks"] as const,
  search: (wsId: string, q: string) => ["workspace", wsId, "search", q] as const,
  snapshots: (id: string) => ["page", id, "snapshots"] as const,
};

function invalidateWorkspace(qc: QueryClient, wsId: string): void {
  void qc.invalidateQueries({ queryKey: queryKeys.tree(wsId) });
  void qc.invalidateQueries({ queryKey: queryKeys.trash(wsId) });
}

export function useWorkspaces() {
  return useQuery({ queryKey: queryKeys.workspaces, queryFn: () => api.listWorkspaces() });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.createWorkspace(name),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.workspaces }),
  });
}

export function usePageTree(wsId: string | null) {
  return useQuery({
    queryKey: wsId ? queryKeys.tree(wsId) : ["pages", "none", "tree"],
    queryFn: () => api.listTree(wsId as string),
    enabled: Boolean(wsId),
  });
}

export function useTrash(wsId: string | null) {
  return useQuery({
    queryKey: wsId ? queryKeys.trash(wsId) : ["pages", "none", "trash"],
    queryFn: () => api.listTrash(wsId as string),
    enabled: Boolean(wsId),
  });
}

export function usePage(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.page(id) : ["page", "none"],
    queryFn: () => api.getPage(id as string),
    enabled: Boolean(id),
  });
}

export function usePageContent(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.content(id) : ["page", "none", "content"],
    queryFn: () => api.getContent(id as string),
    enabled: Boolean(id),
  });
}

export function useBacklinks(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.backlinks(id) : ["page", "none", "backlinks"],
    queryFn: () => api.getBacklinks(id as string),
    enabled: Boolean(id),
  });
}

export function useCreatePage(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePageInput) => api.createPage(wsId, input),
    onSuccess: () => invalidateWorkspace(qc, wsId),
  });
}

export function useUpdatePage(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePageInput }) =>
      api.updatePage(id, input),
    onSuccess: (page) => {
      invalidateWorkspace(qc, wsId);
      void qc.invalidateQueries({ queryKey: queryKeys.page(page.id) });
    },
  });
}

export function useMovePage(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: MovePageInput }) => api.movePage(id, input),
    onSuccess: () => invalidateWorkspace(qc, wsId),
  });
}

export function useArchivePage(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.archivePage(id),
    onSuccess: () => invalidateWorkspace(qc, wsId),
  });
}

export function useRestorePage(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.restorePage(id),
    onSuccess: () => invalidateWorkspace(qc, wsId),
  });
}

// ── Search (command palette) ────────────────────────────────────
export function useSearch(wsId: string, q: string, enabled = true) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: queryKeys.search(wsId, trimmed),
    queryFn: () => searchApi.search(wsId, trimmed),
    enabled: enabled && trimmed.length > 0,
    // The caller debounces input; keep prior results while a new query loads.
    placeholderData: (prev) => prev,
  });
}

// ── Version history / snapshots ─────────────────────────────────
export function useSnapshots(id: string | null, enabled = true) {
  return useQuery({
    queryKey: id ? queryKeys.snapshots(id) : ["page", "none", "snapshots"],
    queryFn: () => api.listSnapshots(id as string),
    enabled: Boolean(id) && enabled,
  });
}

export function useCreateSnapshot(pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (label?: string) => api.createSnapshot(pageId, label),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.snapshots(pageId) }),
  });
}

export function useRestoreSnapshot(pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (snapId: string) => api.restoreSnapshot(pageId, snapId),
    onSuccess: () => {
      // Refetch the page + its content so the restored state surfaces.
      void qc.invalidateQueries({ queryKey: queryKeys.page(pageId) });
      void qc.invalidateQueries({ queryKey: queryKeys.content(pageId) });
      void qc.invalidateQueries({ queryKey: queryKeys.snapshots(pageId) });
    },
  });
}
