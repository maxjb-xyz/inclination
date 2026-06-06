import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";
import { EditorContent, useEditor } from "@tiptap/react";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import type { CollabSession } from "../collab/session";
import { buildWebExtensions } from "../editor/extensions";
import { BlockHandle } from "../editor/BlockHandle";

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
 * Collaborative Tiptap editor bound to a Yjs document, with the full §7 block
 * set (slash menu, all block types, Markdown shortcuts) wired in.
 *
 * Block extensions come from `@inclination/editor` via {@link buildWebExtensions}
 * with `collaboration: true`, so no local history runs — the Collaboration
 * extension supplies Yjs-aware undo/redo. CollaborationCursor renders remote
 * carets. A custom {@link BlockHandle} overlay provides drag/duplicate/delete/
 * turn-into. The editor is keyed on the doc identity (via the `useEditor` deps)
 * so switching pages rebuilds it against the new doc.
 */
export function Editor({ session, user }: EditorProps): React.ReactElement {
  const { doc, provider } = session;

  const editor = useEditor(
    {
      extensions: [
        // Full §7 block set; history off (Collaboration owns undo/redo).
        ...buildWebExtensions({ collaboration: true }),
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
      {editor ? <BlockHandle editor={editor} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}
