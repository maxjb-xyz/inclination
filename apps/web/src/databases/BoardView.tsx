import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type {
  CellValue,
  Property,
  QueryGroup,
  QueryResultRow,
  View,
} from "./dbTypes";
import { formatCellValue } from "./cellHelpers";
import { BOARD_COLUMN_PREFIX, boardDrop } from "./boardMove";
import { primaryProperty, visiblePropertiesFor } from "./viewHelpers";

export interface BoardViewProps {
  view: View;
  properties: Property[];
  rows: QueryResultRow[];
  groups: QueryGroup[];
  /** The select/status property the board is grouped by. */
  groupByPropertyId: string;
  onSetCell: (rowId: string, propertyId: string, value: CellValue) => void;
}

/**
 * Kanban board grouped by a select/status property. Columns come from the query
 * response `groups` (the engine produces an ordered, complete column set incl.
 * the empty column). Dragging a card to another column PUTs the grouping cell to
 * that column's option (or clears it); the parent's optimistic mutation handles
 * the cache. The move math is {@link moveCardValue} (unit-tested).
 */
export function BoardView({
  view,
  properties,
  rows,
  groups,
  groupByPropertyId,
  onSetCell,
}: BoardViewProps): React.ReactElement {
  const sensors = useSensors(useSensor(PointerSensor));
  const rowById = new Map(rows.map((r) => [r.pageId, r]));
  const primary = primaryProperty(properties);
  const visible = visiblePropertiesFor(view, properties).filter(
    (p) => p.id !== groupByPropertyId,
  );

  function handleDragEnd(event: DragEndEvent): void {
    const drop = boardDrop(String(event.active.id), event.over ? String(event.over.id) : null);
    if (!drop) return;
    onSetCell(drop.rowId, groupByPropertyId, drop.value);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="db-board" data-testid="db-board">
        {groups.map((group) => (
          <BoardColumn key={group.key} group={group}>
            {group.pageIds.map((pageId) => {
              const row = rowById.get(pageId);
              if (!row) return null;
              return (
                <BoardCard key={pageId} pageId={pageId}>
                  <div className="db-card__title">
                    {primary ? formatCellValue(primary, row.cells[primary.id] ?? null) || "Untitled" : "Untitled"}
                  </div>
                  {visible
                    .filter((p) => p.id !== primary?.id)
                    .map((p) => (
                      <div key={p.id} className="db-card__prop">
                        <span className="db-card__prop-name">{p.name}:</span>{" "}
                        {formatCellValue(p, row.cells[p.id] ?? null)}
                      </div>
                    ))}
                </BoardCard>
              );
            })}
          </BoardColumn>
        ))}
      </div>
    </DndContext>
  );
}

function BoardColumn({
  group,
  children,
}: {
  group: QueryGroup;
  children: React.ReactNode;
}): React.ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: `${BOARD_COLUMN_PREFIX}${group.key}` });
  return (
    <div
      ref={setNodeRef}
      className={`db-board__col${isOver ? " db-board__col--over" : ""}`}
      data-testid={`db-board-col-${group.key || "empty"}`}
    >
      <h4 className="db-board__col-title">
        {group.label} <span className="db-board__count">{group.pageIds.length}</span>
      </h4>
      <div className="db-board__cards">{children}</div>
    </div>
  );
}

function BoardCard({
  pageId,
  children,
}: {
  pageId: string;
  children: React.ReactNode;
}): React.ReactElement {
  const { setNodeRef, attributes, listeners, transform, isDragging } = useDraggable({
    id: pageId,
  });
  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`db-card${isDragging ? " db-card--dragging" : ""}`}
      data-testid={`db-card-${pageId}`}
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  );
}
