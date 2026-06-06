import { useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { debounce } from "./debounce";

export interface EditorProps {
  /** The page id; remounts the editor when it changes so content reloads. */
  pageId: string;
  /** Initial Tiptap/ProseMirror JSON doc (empty object => blank doc). */
  initialDoc: Record<string, unknown>;
  /** Persist callback; called debounced as the user types. */
  onSave: (doc: Record<string, unknown>) => void;
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
  const debouncedSave = useMemo(
    () => debounce((doc: Record<string, unknown>) => onSaveRef.current(doc), debounceMs),
    [debounceMs],
  );

  const editor = useEditor(
    {
      extensions: [StarterKit],
      content: hasContent(initialDoc) ? initialDoc : undefined,
      onUpdate: ({ editor: ed }) => {
        debouncedSave(ed.getJSON() as Record<string, unknown>);
      },
    },
    [pageId],
  );

  useEffect(() => {
    return () => debouncedSave.flush();
  }, [debouncedSave]);

  return (
    <div className="editor" data-testid="editor">
      <EditorContent editor={editor} />
    </div>
  );
}
