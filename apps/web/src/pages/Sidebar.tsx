import { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Page } from "../api/types";
import { buildTree } from "./buildTree";
import { flattenTree, type FlatItem } from "./flattenTree";
import { projectMove } from "./projectMove";

export interface SidebarProps {
  pages: Page[];
  activePageId: string | null;
  onSelect: (id: string) => void;
  onCreateRoot: () => void;
  onCreateChild: (parentId: string) => void;
  onArchive: (id: string) => void;
  onMove: (id: string, plan: ReturnType<typeof projectMove>) => void;
  onOpenTrash: () => void;
}

function SortableRow({
  item,
  active,
  onSelect,
  onCreateChild,
  onArchive,
  collapsed,
  onToggle,
}: {
  item: FlatItem;
  active: boolean;
  onSelect: (id: string) => void;
  onCreateChild: (id: string) => void;
  onArchive: (id: string) => void;
  collapsed: boolean;
  onToggle: (id: string) => void;
}): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    paddingLeft: 8 + item.depth * 16,
  };
  return (
    <li ref={setNodeRef} style={style} className="sidebar-row" data-testid="page-row">
      {item.hasChildren ? (
        <button
          type="button"
          className="twisty"
          aria-label={collapsed ? "Expand" : "Collapse"}
          onClick={() => onToggle(item.id)}
        >
          {collapsed ? "▸" : "▾"}
        </button>
      ) : (
        <span className="twisty-spacer" />
      )}
      <span className="drag-handle" {...attributes} {...listeners} aria-label="Drag" role="button">
        {"☰"}
      </span>
      <button
        type="button"
        className={`page-link${active ? " active" : ""}`}
        onClick={() => onSelect(item.id)}
      >
        <span className="page-icon">{item.icon ?? "\u{1F4C4}"}</span>
        <span className="page-title">{item.title || "Untitled"}</span>
      </button>
      <button
        type="button"
        className="row-action"
        aria-label="Add subpage"
        title="Add subpage"
        onClick={() => onCreateChild(item.id)}
      >
        +
      </button>
      <button
        type="button"
        className="row-action"
        aria-label="Delete page"
        title="Move to trash"
        onClick={() => onArchive(item.id)}
      >
        {"\u{1F5D1}"}
      </button>
    </li>
  );
}

export function Sidebar({
  pages,
  activePageId,
  onSelect,
  onCreateRoot,
  onCreateChild,
  onArchive,
  onMove,
  onOpenTrash,
}: SidebarProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildTree(pages), [pages]);
  const flat = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);
  const ids = useMemo(() => flat.map((f) => f.id), [flat]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function toggle(id: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const plan = projectMove(pages, String(active.id), String(over.id));
    if (plan) onMove(String(active.id), plan);
  }

  return (
    <nav className="sidebar" aria-label="Pages">
      <div className="sidebar-header">
        <strong>Pages</strong>
        <button type="button" onClick={onCreateRoot} aria-label="New page">
          + New
        </button>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="page-list">
            {flat.map((item) => (
              <SortableRow
                key={item.id}
                item={item}
                active={item.id === activePageId}
                onSelect={onSelect}
                onCreateChild={onCreateChild}
                onArchive={onArchive}
                collapsed={collapsed.has(item.id)}
                onToggle={toggle}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <div className="sidebar-footer">
        <button type="button" onClick={onOpenTrash}>
          {"\u{1F5D1}"} Trash
        </button>
      </div>
    </nav>
  );
}
