import type { ApiClient } from "./apiClient";
import type { Favorite, Recent } from "./types";

/**
 * Favorites + recents REST surface (Phase 9), parameterised by an ApiClient
 * for testability. Endpoints are user-scoped (the server resolves access).
 */
export function createFavoritesApi(client: ApiClient) {
  return {
    listFavorites: () => client.get<Favorite[]>("/favorites"),
    addFavorite: (pageId: string) => client.post<void>(`/pages/${pageId}/favorite`),
    removeFavorite: (pageId: string) => client.del<void>(`/pages/${pageId}/favorite`),
    reorderFavorites: (pageIds: string[]) =>
      client.post<void>("/favorites/reorder", { pageIds }),

    listRecents: () => client.get<Recent[]>("/recents"),
    recordVisit: (pageId: string) => client.post<void>(`/pages/${pageId}/visit`),
  };
}

export type FavoritesApi = ReturnType<typeof createFavoritesApi>;
