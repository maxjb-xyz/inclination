import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import type { CollabSession } from "../collab/session";

export interface CollabUser {
  /** Display name shown on the remote caret label. */
  name: string;
  /** Stable presence color (see collab/color.ts). */
  color: string;
}

export interface EditorProps {
  /**
   * The live collaboration session for the open page (Y.Doc + provider). The
   * editor binds to `session.doc` via Yjs — content is authoritative in Yjs and
   * persisted by the sync server, so there is no REST autosave here.
   */
  session: CollabSession;
  /** The local user, surfaced to other clients as a remote caret. */
  user: CollabUser;
}

/**
 * Collaborative Tiptap editor bound to a Yjs document.
 *
 * StarterKit's history is disabled because the Collaboration extension provides
 * Yjs-aware undo/redo. CollaborationCursor renders remote carets using each
 * peer's awareness `user` field. The editor is keyed on the doc identity (via
 * the `useEditor` deps) so switching pages rebuilds it against the new doc —
 * never reusing one page's editor state for another.
 */
export function Editor({ session, user }: EditorProps): React.ReactElement {
  const { doc, provider } = session;

  const editor = useEditor(
    {
      extensions: [
        // history:false — Collaboration supplies Yjs-based undo/redo instead.
        StarterKit.configure({ history: false }),
        Collaboration.configure({ document: doc }),
        CollaborationCursor.configure({ provider, user }),
      ],
    },
    // Rebuild the editor whenever the underlying doc/provider changes (page
    // switch). Without this, a stale editor would stay bound to the old doc.
    [doc, provider],
  );

  return (
    <div className="editor" data-testid="editor">
      <EditorContent editor={editor} />
    </div>
  );
}
