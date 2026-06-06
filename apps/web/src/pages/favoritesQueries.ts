import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api/apiClient";
import { createFavoritesApi } from "../api/favoritesApi";
import type { Favorite } from "../api/types";

const api = createFavoritesApi(apiClient);

export const favoriteKeys = {
  favorites: ["favorites"] as const,
  recents: ["recents"] as const,
};

export function useFavorites(enabled = true) {
  return useQuery({
    queryKey: favoriteKeys.favorites,
    queryFn: () => api.listFavorites(),
    enabled,
  });
}

export function useRecents(enabled = true) {
  return useQuery({
    queryKey: favoriteKeys.recents,
    queryFn: () => api.listRecents(),
    enabled,
  });
}

/** True when the given page is in the user's favorites (reads cache, no fetch). */
export function useIsFavorite(pageId: string | null): boolean {
  const favorites = useFavorites(Boolean(pageId));
  if (!pageId) return false;
  const list = Array.isArray(favorites.data) ? favorites.data : [];
  return list.some((f) => f.pageId === pageId);
}

/**
 * Toggles a page's favorite status with an optimistic cache update. The
 * `meta` (title/icon) is used to render the optimistic favorites entry before
 * the server confirms.
 */
export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      pageId,
      isFavorite,
    }: {
      pageId: string;
      isFavorite: boolean;
      meta?: { title: string; icon: string | null };
    }) => (isFavorite ? api.removeFavorite(pageId) : api.addFavorite(pageId)),
    onMutate: async ({ pageId, isFavorite, meta }) => {
      await qc.cancelQueries({ queryKey: favoriteKeys.favorites });
      const prev = qc.getQueryData<Favorite[]>(favoriteKeys.favorites);
      qc.setQueryData<Favorite[]>(favoriteKeys.favorites, (cur = []) => {
        if (isFavorite) return cur.filter((f) => f.pageId !== pageId);
        if (cur.some((f) => f.pageId === pageId)) return cur;
        const order = cur.reduce((m, f) => Math.max(m, f.order), -1) + 1;
        return [
          ...cur,
          { pageId, title: meta?.title ?? "Untitled", icon: meta?.icon ?? null, order },
        ];
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(favoriteKeys.favorites, ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: favoriteKeys.favorites });
    },
  });
}

/**
 * Records a visit to a page (fire-and-forget) and refreshes the recents list.
 * Visit failures are swallowed — recents is a convenience surface, not critical.
 */
export function useRecordVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pageId: string) => api.recordVisit(pageId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: favoriteKeys.recents });
    },
    // Recents is best-effort; never surface an error to the user.
    onError: () => {},
  });
}
