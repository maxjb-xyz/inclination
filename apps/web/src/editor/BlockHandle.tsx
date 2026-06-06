import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { useCallback, useEffect, useRef, useState } from "react";

interface HandleState {
  /** ProseMirror position just inside the top-level block under the pointer. */
  pos: number;
  top: number;
  left: number;
}

/**
 * A global drag handle + block menu for the editor.
 *
 * On hover over a top-level block it positions a "⋮⋮" handle in the left gutter.
 * Clicking opens a menu offering Duplicate / Delete / Turn into (paragraph,
 * heading 1-3) / Move up / Move down — all expressed as plain editor commands so
 * they stay Yjs-collaboration-safe.
 */
export function BlockHandle({ editor }: { editor: Editor }): React.ReactElement | null {
  const [handle, setHandle] = useState<HandleState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Track the top-level block under the pointer and place the handle beside it.
  useEffect(() => {
    const dom = editor.view.dom as HTMLElement;
    const onMove = (event: MouseEvent): void => {
      if (menuOpen) return;
      const coords = { left: event.clientX, top: event.clientY };
      const found = editor.view.posAtCoords(coords);
      if (!found) {
        setHandle(null);
        return;
      }
      const $pos = editor.state.doc.resolve(found.inside >= 0 ? found.inside : found.pos);
      // Resolve to the top-level (depth 1) block start.
      const blockPos = $pos.depth >= 1 ? $pos.before(1) : $pos.pos;
      const nodeDom = editor.view.nodeDOM(blockPos) as HTMLElement | null;
      const rect = (nodeDom ?? null)?.getBoundingClientRect();
      const editorRect = dom.getBoundingClientRect();
      if (!rect) {
        setHandle(null);
        return;
      }
      setHandle({
        pos: blockPos,
        top: rect.top - editorRect.top,
        left: -28,
      });
    };
    const onLeave = (): void => {
      if (!menuOpen) setHandle(null);
    };
    dom.addEventListener("mousemove", onMove);
    dom.addEventListener("mouseleave", onLeave);
    return () => {
      dom.removeEventListener("mousemove", onMove);
      dom.removeEventListener("mouseleave", onLeave);
    };
  }, [editor, menuOpen]);

  const selectBlock = useCallback((): number | null => {
    if (!handle) return null;
    const { state, view } = editor;
    const node = state.doc.nodeAt(handle.pos);
    if (!node) return null;
    const tr = state.tr.setSelection(NodeSelection.create(state.doc, handle.pos));
    view.dispatch(tr);
    return handle.pos;
  }, [editor, handle]);

  const duplicate = useCallback((): void => {
    if (!handle) return;
    const node = editor.state.doc.nodeAt(handle.pos);
    if (!node) return;
    const insertAt = handle.pos + node.nodeSize;
    editor.chain().focus().insertContentAt(insertAt, node.toJSON()).run();
    setMenuOpen(false);
  }, [editor, handle]);

  const remove = useCallback((): void => {
    const pos = selectBlock();
    if (pos == null) return;
    editor.chain().focus().deleteSelection().run();
    setMenuOpen(false);
    setHandle(null);
  }, [editor, selectBlock]);

  const turnInto = useCallback(
    (kind: "paragraph" | 1 | 2 | 3): void => {
      if (!handle) return;
      // Put the cursor inside the block (text selection) so the block-type
      // commands apply, then transform.
      const chain = editor.chain().focus().setTextSelection(handle.pos + 1);
      if (kind === "paragraph") chain.setNode("paragraph").run();
      else chain.setNode("heading", { level: kind }).run();
      setMenuOpen(false);
    },
    [editor, handle],
  );

  const move = useCallback(
    (dir: -1 | 1): void => {
      if (!handle) return;
      const { state } = editor;
      const node = state.doc.nodeAt(handle.pos);
      if (!node) return;
      const json = node.toJSON();
      const size = node.nodeSize;
      if (dir === -1) {
        // Swap with the previous sibling: find the node ending at handle.pos.
        const $pos = state.doc.resolve(handle.pos);
        const index = $pos.index(0);
        if (index === 0) {
          setMenuOpen(false);
          return;
        }
        const prevPos = $pos.posAtIndex(index - 1, 0);
        editor
          .chain()
          .focus()
          .deleteRange({ from: handle.pos, to: handle.pos + size })
          .insertContentAt(prevPos, json)
          .run();
      } else {
        const after = handle.pos + size;
        const next = state.doc.nodeAt(after);
        if (!next) {
          setMenuOpen(false);
          return;
        }
        const insertAt = after + next.nodeSize;
        editor
          .chain()
          .focus()
          .insertContentAt(insertAt, json)
          .deleteRange({ from: handle.pos, to: handle.pos + size })
          .run();
      }
      setMenuOpen(false);
      setHandle(null);
    },
    [editor, handle],
  );

  if (!handle) return null;

  return (
    <div
      ref={wrapRef}
      className="block-handle-wrap"
      style={{ top: handle.top, left: handle.left }}
      data-testid="block-handle"
    >
      <button
        type="button"
        className="block-handle"
        aria-label="Open block menu"
        title="Drag to move · click for actions"
        draggable
        onClick={() => setMenuOpen((o) => !o)}
        onDragStart={() => selectBlock()}
      >
        ⋮⋮
      </button>
      {menuOpen ? (
        <div className="block-menu" role="menu" data-testid="block-menu">
          <button type="button" role="menuitem" onClick={duplicate}>
            Duplicate
          </button>
          <button type="button" role="menuitem" onClick={remove}>
            Delete
          </button>
          <div className="block-menu__group">Turn into</div>
          <button type="button" role="menuitem" onClick={() => turnInto("paragraph")}>
            Text
          </button>
          <button type="button" role="menuitem" onClick={() => turnInto(1)}>
            Heading 1
          </button>
          <button type="button" role="menuitem" onClick={() => turnInto(2)}>
            Heading 2
          </button>
          <button type="button" role="menuitem" onClick={() => turnInto(3)}>
            Heading 3
          </button>
          <div className="block-menu__group">Move</div>
          <button type="button" role="menuitem" onClick={() => move(-1)}>
            Move up
          </button>
          <button type="button" role="menuitem" onClick={() => move(1)}>
            Move down
          </button>
        </div>
      ) : null}
    </div>
  );
}
