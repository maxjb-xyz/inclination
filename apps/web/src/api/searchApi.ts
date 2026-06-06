import type { ApiClient } from "./apiClient";
import type { SearchResult } from "./types";

/** Full-text search REST surface, parameterised by an ApiClient for testability. */
export function createSearchApi(client: ApiClient) {
  return {
    /** Workspace-scoped full-text search. Returns ranked page hits with snippets. */
    search: (wsId: string, q: string) =>
      client.get<SearchResult[]>(
        `/workspaces/${wsId}/search?q=${encodeURIComponent(q)}`,
      ),
  };
}

export type SearchApi = ReturnType<typeof createSearchApi>;
