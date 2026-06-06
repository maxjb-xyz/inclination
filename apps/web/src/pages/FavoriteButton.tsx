import { useIsFavorite, useToggleFavorite } from "./favoritesQueries";

/**
 * A star/unstar control for a page header. Toggles the favorite status
 * optimistically via the favorites API. Passes the page's title/icon so the
 * sidebar Favorites entry renders immediately on star.
 */
export function FavoriteButton({
  pageId,
  title,
  icon,
}: {
  pageId: string;
  title: string;
  icon: string | null;
}): React.ReactElement {
  const isFavorite = useIsFavorite(pageId);
  const toggle = useToggleFavorite();
  return (
    <button
      type="button"
      className={`page-action favorite-button${isFavorite ? " is-favorite" : ""}`}
      data-testid="favorite-button"
      aria-pressed={isFavorite}
      aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
      title={isFavorite ? "Remove from favorites" : "Add to favorites"}
      onClick={() => toggle.mutate({ pageId, isFavorite, meta: { title, icon } })}
    >
      {isFavorite ? "★" : "☆"}
    </button>
  );
}
