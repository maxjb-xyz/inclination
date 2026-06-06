import type { FileValue, Property, QueryResultRow, View } from "./dbTypes";
import { formatCellValue, formatComputedValue, isComputedType } from "./cellHelpers";
import { primaryProperty, visiblePropertiesFor } from "./viewHelpers";

export interface GalleryViewProps {
  view: View;
  properties: Property[];
  rows: QueryResultRow[];
}

/** Resolve a card cover image URL from the configured `files` property, if any. */
function coverUrl(view: View, row: QueryResultRow): string | null {
  const gallery = view.config.gallery;
  if (!gallery || gallery.coverSource !== "files_property" || !gallery.coverPropertyId) {
    return null;
  }
  const value = row.cells[gallery.coverPropertyId];
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0] as FileValue | string;
    return typeof first === "object" && first !== null ? first.url : String(first);
  }
  return null;
}

/**
 * Gallery view: a card per row with an optional cover image (from a `files`
 * property) and the visible properties listed beneath.
 */
export function GalleryView({ view, properties, rows }: GalleryViewProps): React.ReactElement {
  const primary = primaryProperty(properties);
  const size = view.config.gallery?.cardSize ?? "medium";
  const visible = visiblePropertiesFor(view, properties).filter((p) => p.id !== primary?.id);

  return (
    <div className={`db-gallery db-gallery--${size}`} data-testid="db-gallery">
      {rows.map((row) => {
        const cover = coverUrl(view, row);
        return (
          <div key={row.pageId} className="db-gallery__card" data-testid={`db-gallery-card-${row.pageId}`}>
            {cover ? <img className="db-gallery__cover" src={cover} alt="" /> : null}
            <div className="db-gallery__title">
              {primary ? formatCellValue(primary, row.cells[primary.id] ?? null) || "Untitled" : "Untitled"}
            </div>
            {visible.map((p) => (
              <div key={p.id} className="db-gallery__prop">
                <span className="db-gallery__prop-name">{p.name}:</span>{" "}
                {isComputedType(p)
                  ? formatComputedValue(p, row.computed[p.id] ?? null)
                  : formatCellValue(p, row.cells[p.id] ?? null)}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
