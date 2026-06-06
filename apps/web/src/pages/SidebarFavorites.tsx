import { useFavorites, useRecents } from "./favoritesQueries";

const DEFAULT_ICON = "\u{1F4C4}";

/** Sidebar "Favorites" section, driven by the favorites API. */
export function FavoritesSection({
  onSelect,
}: {
  onSelect: (id: string) => void;
}): React.ReactElement | null {
  const favorites = useFavorites();
  const items = Array.isArray(favorites.data) ? favorites.data : [];
  if (items.length === 0) return null;
  return (
    <div className="sidebar-section" data-testid="favorites-section">
      <div className="sidebar-section__title">⭐ Favorites</div>
      <ul className="sidebar-section__list">
        {items.map((f) => (
          <li key={f.pageId}>
            <button
              type="button"
              className="sidebar-section__link"
              data-testid="favorite-item"
              onClick={() => onSelect(f.pageId)}
            >
              <span className="page-icon">{f.icon ?? DEFAULT_ICON}</span>
              <span className="page-title">{f.title || "Untitled"}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Sidebar "Recent" section, driven by the recents API. */
export function RecentsSection({
  onSelect,
}: {
  onSelect: (id: string) => void;
}): React.ReactElement | null {
  const recents = useRecents();
  const items = Array.isArray(recents.data) ? recents.data : [];
  if (items.length === 0) return null;
  return (
    <div className="sidebar-section" data-testid="recents-section">
      <div className="sidebar-section__title">🕘 Recent</div>
      <ul className="sidebar-section__list">
        {items.map((r) => (
          <li key={r.pageId}>
            <button
              type="button"
              className="sidebar-section__link"
              data-testid="recent-item"
              onClick={() => onSelect(r.pageId)}
            >
              <span className="page-icon">{r.icon ?? DEFAULT_ICON}</span>
              <span className="page-title">{r.title || "Untitled"}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
