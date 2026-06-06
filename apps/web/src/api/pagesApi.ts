import type {
  CreatePageInput,
  MovePageInput,
  UpdatePageInput,
} from "@inclination/shared";
import type { ApiClient } from "./apiClient";
import type {
  Backlink,
  MentionableResult,
  Page,
  PageContent,
  PageWithBreadcrumbs,
  Snapshot,
  SnapshotContent,
  Workspace,
} from "./types";

/** Workspace + page REST surface, parameterised by an ApiClient for testability. */
export function createPagesApi(client: ApiClient) {
  return {
    // Workspaces
    listWorkspaces: () => client.get<Workspace[]>("/workspaces"),
    createWorkspace: (name: string) => client.post<Workspace>("/workspaces", { name }),

    // Pages (workspace-scoped)
    listTree: (wsId: string) => client.get<Page[]>(`/workspaces/${wsId}/pages`),
    listTrash: (wsId: string) => client.get<Page[]>(`/workspaces/${wsId}/trash`),
    createPage: (wsId: string, input: CreatePageInput) =>
      client.post<Page>(`/workspaces/${wsId}/pages`, input),

    // Pages (page-scoped)
    getPage: (id: string) => client.get<PageWithBreadcrumbs>(`/pages/${id}`),
    updatePage: (id: string, input: UpdatePageInput) =>
      client.patch<Page>(`/pages/${id}`, input),
    movePage: (id: string, input: MovePageInput) =>
      client.post<Page>(`/pages/${id}/move`, input),
    archivePage: (id: string) => client.del<{ archived: number }>(`/pages/${id}`),
    restorePage: (id: string) => client.post<{ restored: number }>(`/pages/${id}/restore`),

    // Content
    getContent: (id: string) => client.get<PageContent>(`/pages/${id}/content`),
    saveContent: (id: string, doc: Record<string, unknown>) =>
      client.put<PageContent>(`/pages/${id}/content`, { doc }),

    // References / backlinks (Phase 4)
    searchMentionable: (wsId: string, q: string) =>
      client.get<MentionableResult>(
        `/workspaces/${wsId}/search/mentionable?q=${encodeURIComponent(q)}`,
      ),
    putReferences: (id: string, pageIds: string[]) =>
      client.put<{ count: number }>(`/pages/${id}/references`, { pageIds }),
    getBacklinks: (id: string) => client.get<Backlink[]>(`/pages/${id}/backlinks`),

    // Version history / snapshots (Phase 7)
    listSnapshots: (id: string) => client.get<Snapshot[]>(`/pages/${id}/snapshots`),
    getSnapshot: (id: string, snapId: string) =>
      client.get<SnapshotContent>(`/pages/${id}/snapshots/${snapId}`),
    createSnapshot: (id: string, label?: string) =>
      client.post<Snapshot>(`/pages/${id}/snapshots`, label ? { label } : {}),
    restoreSnapshot: (id: string, snapId: string) =>
      client.post<{ restored: boolean }>(`/pages/${id}/snapshots/${snapId}/restore`),
  };
}

export type PagesApi = ReturnType<typeof createPagesApi>;
