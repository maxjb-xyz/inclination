import type {
  CreatePageInput,
  MovePageInput,
  UpdatePageInput,
} from "@inclination/shared";
import type { ApiClient } from "./apiClient";
import type { Page, PageContent, PageWithBreadcrumbs, Workspace } from "./types";

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
  };
}

export type PagesApi = ReturnType<typeof createPagesApi>;
