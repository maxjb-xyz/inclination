import { useMemo, useRef, useState } from "react";
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
import { FavoritesSection, RecentsSection } from "./SidebarFavorites";

export interface SidebarProps {
  pages: Page[];
  activePageId: string | null;
  onSelect: (id: string) => void;
  onCreateRoot: () => void;
  onCreateChild: (parentId: string) => void;
  onArchive: (id: string) => void;
  onMove: (id: string, plan: ReturnType<typeof projectMove>) => void;
  onOpenTrash: () => void;
  /** Import a Markdown file's text into a new page tree. */
  onImport: (filename: string, markdown: string) => void | Promise<void>;
}

/** Read a File's text content via FileReader (portable across browsers + jsdom). */
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsText(file);
  });
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
  onImport,
}: SidebarProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    // Reset the input so re-selecting the same file fires `change` again.
    e.target.value = "";
    if (!file) return;
    // Read via FileReader — portable across browsers and jsdom (whose File
    // polyfill lacks a working `.text()` / Response-blob path).
    const markdown = await readFileText(file);
    await onImport(file.name, markdown);
  }
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
        <button
          type="button"
          aria-label="Import Markdown"
          title="Import a .md file"
          onClick={() => fileInputRef.current?.click()}
        >
          ⬆ Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,text/markdown"
          aria-label="Import Markdown file"
          data-testid="import-md-input"
          style={{ display: "none" }}
          onChange={(e) => void handleImportFile(e)}
        />
      </div>
      <FavoritesSection onSelect={onSelect} />
      <RecentsSection onSelect={onSelect} />
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
