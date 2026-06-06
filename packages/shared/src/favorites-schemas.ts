import { z } from "zod";

/**
 * Phase 9 — favorites & recents inputs (spec §5).
 *
 * Favoriting/visiting a page is keyed by the page id in the route; the only
 * body payload is the reorder request. Ids are deduped and capped so the server
 * receives a clean, bounded set.
 */

/** Reorder the caller's favorites: `POST /favorites/reorder`. The array is the
 * desired top-to-bottom order; `order` is written as the array index. Ids the
 * caller has not favorited (or can no longer access) are ignored by the service. */
export const reorderFavoritesSchema = z.object({
  pageIds: z
    .array(z.string().uuid())
    .max(1000)
    .transform((ids) => Array.from(new Set(ids))),
});
export type ReorderFavoritesInput = z.infer<typeof reorderFavoritesSchema>;
