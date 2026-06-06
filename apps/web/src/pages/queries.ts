import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { CreatePageInput, MovePageInput, UpdatePageInput } from "@inclination/shared";
import { apiClient } from "../api/apiClient";
import { createPagesApi } from "../api/pagesApi";

const api = createPagesApi(apiClient);

export const queryKeys = {
  workspaces: ["workspaces"] as const,
  tree: (wsId: string) => ["pages", wsId, "tree"] as const,
  trash: (wsId: string) => ["pages", wsId, "trash"] as const,
  page: (id: string) => ["page", id] as const,
  content: (id: string) => ["page", id, "content"] as const,
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
