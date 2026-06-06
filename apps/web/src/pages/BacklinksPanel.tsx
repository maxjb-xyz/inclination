import type { Backlink } from "../api/types";

export interface BacklinksPanelProps {
  /** Pages that reference the current page (from `GET /pages/:id/backlinks`). */
  backlinks: Backlink[];
  /** Navigate to a backlinking page. */
  onOpenPage: (pageId: string) => void;
  /** True while the backlinks query is loading (initial fetch). */
  loading?: boolean;
}

/**
 * "Linked references" panel: lists the pages that link to (mention or
 * page-link) the current page. Clicking a row navigates to that page via the
 * shared open-page handler. Hidden entirely when there are no backlinks so it
 * does not clutter pages with no inbound references.
 */
export function BacklinksPanel({
  backlinks,
  onOpenPage,
  loading,
}: BacklinksPanelProps): React.ReactElement | null {
  if (loading) {
    return (
      <section className="backlinks" data-testid="backlinks-panel">
        <h2 className="backlinks__title">Linked references</h2>
        <p className="backlinks__empty">Loading…</p>
      </section>
    );
  }

  if (backlinks.length === 0) return null;

  return (
    <section className="backlinks" data-testid="backlinks-panel">
      <h2 className="backlinks__title">
        Linked references
        <span className="backlinks__count">{backlinks.length}</span>
      </h2>
      <ul className="backlinks__list">
        {backlinks.map((b) => (
          <li key={b.id}>
            <button
              type="button"
              className="backlinks__item"
              data-page-id={b.id}
              onClick={() => onOpenPage(b.id)}
            >
              <span className="backlinks__icon" aria-hidden="true">
                {b.icon ?? "\u{1F4C4}"}
              </span>
              {b.title || "Untitled"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
