import { useMemo, useState } from "react";
import type { ViewConfig, ViewType } from "@inclination/shared";
import { usePageTree } from "../pages/queries";
import {
  useCreateProperty,
  useCreateRow,
  useCreateView,
  useDatabase,
  useDatabaseQuery,
  useDeleteProperty,
  useSetCell,
  useUpdateProperty,
  useUpdateView,
} from "./queries";
import { useDatabaseRealtime } from "./useDatabaseRealtime";
import { TableView } from "./TableView";
import { BoardView } from "./BoardView";
import { CalendarView } from "./CalendarView";
import { GalleryView } from "./GalleryView";
import { ViewControls } from "./ViewControls";
import { AddPropertyForm, EditPropertyForm } from "./PropertyEditor";
import type { CellValue, View } from "./dbTypes";

export interface DatabaseViewProps {
  /** The database (container page) id. */
  databaseId: string;
  workspaceId: string;
  /** Render in a compact inline frame (for the editor node). */
  inline?: boolean;
}

const VIEW_LABELS: Record<ViewType, string> = {
  table: "Table",
  board: "Board",
  calendar: "Calendar",
  gallery: "Gallery",
};

/**
 * Container for a database page (or an inline/linked database block): a view
 * switcher, per-view controls, and the active view. Drives every view from the
 * query endpoint (server-side filter/sort/group) and subscribes to realtime.
 */
export function DatabaseView({
  databaseId,
  workspaceId,
  inline,
}: DatabaseViewProps): React.ReactElement {
  const dbQuery = useDatabase(databaseId);
  const tree = usePageTree(workspaceId);
  useDatabaseRealtime(databaseId);

  const createRow = useCreateRow(databaseId);
  const setCell = useSetCell(databaseId);
  const createProperty = useCreateProperty(databaseId);
  const updateProperty = useUpdateProperty(databaseId);
  const deleteProperty = useDeleteProperty(databaseId);
  const createView = useCreateView(databaseId);
  const updateView = useUpdateView(databaseId);

  const database = dbQuery.data;
  const views = database?.views ?? [];
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [showAddProperty, setShowAddProperty] = useState(false);
  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(null);

  const activeView: View | undefined =
    views.find((v) => v.id === activeViewId) ??
    views.find((v) => v.id === database?.defaultViewId) ??
    views[0];

  const result = useDatabaseQuery(database ? databaseId : null, {
    viewId: activeView?.id,
  });

  const relationTargets = useMemo(
    () =>
      (tree.data ?? [])
        .filter((p) => p.type === "database" && p.id !== databaseId)
        .map((p) => ({ id: p.id, title: p.title })),
    [tree.data, databaseId],
  );

  if (dbQuery.isLoading) {
    return <div className="db-view db-view--loading">Loading database…</div>;
  }
  if (dbQuery.isError || !database || !activeView) {
    return <div className="db-view db-view--error">Could not load this database.</div>;
  }

  const properties = database.properties;
  const rows = result.data?.rows ?? [];
  const groups = result.data?.groups ?? [];

  function commitViewConfig(config: ViewConfig): void {
    if (!activeView) return;
    updateView.mutate({ id: activeView.id, input: { config } });
  }

  function handleSetCell(rowId: string, propertyId: string, value: CellValue): void {
    setCell.mutate({ rowId, propertyId, value });
  }

  function switchType(type: ViewType): void {
    if (!activeView) return;
    // Reuse the active view by switching its type; ensure a sensible default for
    // board (group_by) / calendar (date_property) so the view is usable.
    const config = { ...activeView.config };
    if (type === "board" && !config.groupBy) {
      const firstGroupable = properties.find((p) => p.type === "select" || p.type === "status");
      if (firstGroupable) config.groupBy = firstGroupable.id;
    }
    if (type === "calendar" && !config.dateProperty) {
      const firstDate = properties.find((p) => p.type === "date");
      if (firstDate) config.dateProperty = firstDate.id;
    }
    updateView.mutate({ id: activeView.id, input: { type, config } });
  }

  const editingProperty = properties.find((p) => p.id === editingPropertyId);

  return (
    <div className={`db-view${inline ? " db-view--inline" : ""}`} data-testid="db-view">
      <div className="db-view__bar">
        <div className="db-view__tabs" data-testid="db-view-switcher">
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`db-tab${v.id === activeView.id ? " db-tab--active" : ""}`}
              data-testid={`db-view-tab-${v.id}`}
              onClick={() => setActiveViewId(v.id)}
            >
              {v.name} <span className="db-tab__type">{VIEW_LABELS[v.type]}</span>
            </button>
          ))}
          <button
            type="button"
            className="db-tab db-tab--add"
            data-testid="db-add-view"
            onClick={() =>
              createView.mutate(
                { type: "table", name: "Table" },
                { onSuccess: (v) => setActiveViewId(v.id) },
              )
            }
          >
            + View
          </button>
        </div>
        <div className="db-view__type-switch">
          {(Object.keys(VIEW_LABELS) as ViewType[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`db-typebtn${activeView.type === t ? " db-typebtn--active" : ""}`}
              data-testid={`db-set-type-${t}`}
              onClick={() => switchType(t)}
            >
              {VIEW_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      <ViewControls
        view={activeView}
        properties={properties}
        onConfigChange={commitViewConfig}
      />

      {showAddProperty ? (
        <AddPropertyForm
          relationTargets={relationTargets}
          database={database}
          onCreate={(input) =>
            createProperty.mutate(input, { onSuccess: () => setShowAddProperty(false) })
          }
          onCancel={() => setShowAddProperty(false)}
        />
      ) : null}

      {editingProperty ? (
        <EditPropertyForm
          property={editingProperty}
          relationTargets={relationTargets}
          database={database}
          onSave={(input) =>
            updateProperty.mutate(
              { id: editingProperty.id, input },
              { onSuccess: () => setEditingPropertyId(null) },
            )
          }
          onDelete={() =>
            deleteProperty.mutate(editingProperty.id, {
              onSuccess: () => setEditingPropertyId(null),
            })
          }
          onClose={() => setEditingPropertyId(null)}
        />
      ) : null}

      <div className="db-view__body">
        {activeView.type === "table" ? (
          <TableView
            view={activeView}
            properties={properties}
            rows={rows}
            onSetCell={handleSetCell}
            onAddRow={() => createRow.mutate({})}
            onAddProperty={() => setShowAddProperty(true)}
            onConfigureProperty={(id) => setEditingPropertyId(id)}
          />
        ) : activeView.type === "board" ? (
          activeView.config.groupBy ? (
            <BoardView
              view={activeView}
              properties={properties}
              rows={rows}
              groups={groups}
              groupByPropertyId={activeView.config.groupBy}
              onSetCell={handleSetCell}
            />
          ) : (
            <p className="db-view__hint">Pick a “Group by” property to use the board.</p>
          )
        ) : activeView.type === "calendar" ? (
          activeView.config.dateProperty ? (
            <CalendarView
              view={activeView}
              properties={properties}
              rows={rows}
              datePropertyId={activeView.config.dateProperty}
            />
          ) : (
            <p className="db-view__hint">Pick a date property for the calendar.</p>
          )
        ) : (
          <GalleryView view={activeView} properties={properties} rows={rows} />
        )}
      </div>
    </div>
  );
}
