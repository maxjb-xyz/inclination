import type { CellValue, Property, QueryResultRow, View } from "./dbTypes";
import { CellEditor } from "./CellEditor";
import { formatComputedValue, isComputedType } from "./cellHelpers";
import { visiblePropertiesFor } from "./viewHelpers";

export interface TableViewProps {
  view: View;
  properties: Property[];
  rows: QueryResultRow[];
  onSetCell: (rowId: string, propertyId: string, value: CellValue) => void;
  onAddRow: () => void;
  onAddProperty: () => void;
  /** Open the property config dialog for a header. */
  onConfigureProperty?: (propertyId: string) => void;
}

/**
 * Table view: rows × visible properties. Settable cells get an inline
 * {@link CellEditor}; computed/relation cells render read-only formatted text.
 *
 * Simple full render (no windowing) — rows come pre-paginated from the query
 * endpoint, so a page is bounded. A note for T6: virtualization is deferred.
 */
export function TableView({
  view,
  properties,
  rows,
  onSetCell,
  onAddRow,
  onAddProperty,
  onConfigureProperty,
}: TableViewProps): React.ReactElement {
  const visible = visiblePropertiesFor(view, properties);

  return (
    <div className="db-table" data-testid="db-table">
      <table>
        <thead>
          <tr>
            {visible.map((prop) => (
              <th key={prop.id} data-testid={`db-col-${prop.id}`}>
                <button
                  type="button"
                  className="db-col-header"
                  onClick={() => onConfigureProperty?.(prop.id)}
                >
                  {prop.name}
                  <span className="db-col-type">{prop.type}</span>
                </button>
              </th>
            ))}
            <th className="db-add-col">
              <button type="button" data-testid="db-add-property" onClick={onAddProperty}>
                + Property
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.pageId} data-testid={`db-row-${row.pageId}`}>
              {visible.map((prop) => (
                <td key={prop.id} data-testid={`db-cell-${row.pageId}-${prop.id}`}>
                  {isComputedType(prop) ? (
                    <span className="db-cell-computed">
                      {formatComputedValue(prop, row.computed[prop.id] ?? null)}
                    </span>
                  ) : (
                    <CellEditor
                      property={prop}
                      value={row.cells[prop.id] ?? null}
                      onChange={(value) => onSetCell(row.pageId, prop.id, value)}
                    />
                  )}
                </td>
              ))}
              <td />
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="db-add-row" data-testid="db-add-row" onClick={onAddRow}>
        + New row
      </button>
    </div>
  );
}
