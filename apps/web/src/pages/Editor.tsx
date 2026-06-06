import { useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { debounce } from "./debounce";

export interface EditorProps {
  /** The page id; remounts the editor when it changes so content reloads. */
  pageId: string;
  /** Initial Tiptap/ProseMirror JSON doc (empty object => blank doc). */
  initialDoc: Record<string, unknown>;
  /**
   * Persist callback; called debounced as the user types. Receives the doc and
   * the id of the page the edit was made in, so a pending save always targets
   * the originating page even if the active page changed in the meantime.
   */
  onSave: (doc: Record<string, unknown>, pageId: string) => void;
  /** Debounce window in ms. */
  debounceMs?: number;
}

/** Returns true if the doc looks like a usable ProseMirror document. */
function hasContent(doc: Record<string, unknown>): boolean {
  return typeof doc === "object" && doc !== null && doc.type === "doc";
}

export function Editor({
  pageId,
  initialDoc,
  onSave,
  debounceMs = 600,
}: EditorProps): React.ReactElement {
  // Keep a stable debounced saver; flush on unmount / page change.
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  // The debounced saver carries the target pageId alongside the doc, so a
  // pending edit is always committed to the page it was typed in — never the
  // page that happens to be active when the timer fires.
  const debouncedSave = useMemo(
    () =>
      debounce(
        (doc: Record<string, unknown>, targetPageId: string) =>
          onSaveRef.current(doc, targetPageId),
        debounceMs,
      ),
    [debounceMs],
  );

  // Snapshot the current pageId so onUpdate binds the edit to the right page.
  const pageIdRef = useRef(pageId);
  pageIdRef.current = pageId;

  const editor = useEditor(
    {
      extensions: [StarterKit],
      content: hasContent(initialDoc) ? initialDoc : undefined,
      onUpdate: ({ editor: ed }) => {
        debouncedSave(ed.getJSON() as Record<string, unknown>, pageIdRef.current);
      },
    },
    [pageId],
  );

  // When the page changes, flush any pending save FIRST (so it lands on the
  // page it was typed in, with that page's id bound into the call), then the
  // ref update for the new page takes effect for subsequent edits.
  useEffect(() => {
    return () => debouncedSave.flush();
  }, [debouncedSave, pageId]);

  return (
    <div className="editor" data-testid="editor">
      <EditorContent editor={editor} />
    </div>
  );
}
