import { useEffect, useMemo, useState } from "react";
import { Repeat2 } from "lucide-react";
import { EditorContent, NodeViewWrapper, useEditor, type NodeViewProps } from "@tiptap/react";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import { buildBlockExtensions } from "@inclination/editor";
import { createSyncedSession, type SyncedSession } from "../collab/session";
import { useSyncedBlockEditorContext } from "./syncedBlockContext";

/**
 * Inner editor bound to a synced block's `synced:{id}` Yjs doc. Split out so the
 * collab session is created/torn down by `id` identity and the Tiptap editor is
 * rebuilt against the new doc when the id changes. Embedding the same id on two
 * pages → same server-side doc → edits propagate.
 */
function SyncedEditor({
  syncedBlockId,
  token,
  userName,
  userColor,
  editable,
}: {
  syncedBlockId: string;
  token: string;
  userName: string;
  userColor: string;
  editable: boolean;
}): React.ReactElement {
  const [session, setSession] = useState<SyncedSession | null>(null);

  // One session per (id, token): created on mount, torn down cleanly on unmount
  // or when the id/token changes — so no leaked websocket or cross-block reuse.
  useEffect(() => {
    const created = createSyncedSession({ syncedBlockId, token });
    setSession(created);
    return () => {
      created.destroy();
      setSession(null);
    };
  }, [syncedBlockId, token]);

  const user = useMemo(() => ({ name: userName, color: userColor }), [userName, userColor]);

  const editor = useEditor(
    session
      ? {
          editable,
          extensions: [
            // No local history — the Collaboration extension owns Yjs undo/redo.
            ...buildBlockExtensions({ collaboration: true }),
            Collaboration.configure({ document: session.doc }),
            CollaborationCursor.configure({ provider: session.provider, user }),
          ],
        }
      : { editable, extensions: buildBlockExtensions({ collaboration: false }) },
    // Rebuild whenever the bound doc changes (id/token switch).
    [session, editable],
  );

  return (
    <div className="synced-block__editor" data-testid="synced-block-editor">
      <EditorContent editor={editor} />
    </div>
  );
}

/**
 * React NodeView for the `syncedBlock` block.
 *
 *  - With a `syncedBlockId`, it mounts a nested collaborative Tiptap editor
 *    bound to that block's `synced:{id}` doc (its OWN Yjs document, served to
 *    every host page that embeds the same id, so edits propagate).
 *  - Without one, it offers a button to create a synced block (used when the
 *    slash action inserts an empty node) — the created id is written into attrs.
 */
export function SyncedBlockView({
  node,
  updateAttributes,
  editor,
}: NodeViewProps): React.ReactElement {
  const syncedBlockId = (node.attrs.syncedBlockId as string | null) ?? null;
  const ctx = useSyncedBlockEditorContext();
  const [creating, setCreating] = useState(false);

  if (!syncedBlockId) {
    return (
      <NodeViewWrapper className="synced-block synced-block--empty" data-testid="synced-block">
        <button
          type="button"
          data-testid="synced-block-create"
          disabled={!ctx || creating || !editor.isEditable}
          onClick={async () => {
            if (!ctx) return;
            setCreating(true);
            try {
              const id = await ctx.createSyncedBlock();
              updateAttributes({ syncedBlockId: id });
            } finally {
              setCreating(false);
            }
          }}
        >
          {creating ? "Creating…" : "+ Create synced block"}
        </button>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      className="synced-block"
      data-testid="synced-block"
      data-synced-block-id={syncedBlockId}
    >
      <div className="synced-block__badge" contentEditable={false}>
        <Repeat2 size={13} /> Synced block
      </div>
      {ctx ? (
        <SyncedEditor
          syncedBlockId={syncedBlockId}
          token={ctx.token}
          userName={ctx.userName}
          userColor={ctx.userColor}
          editable={editor.isEditable}
        />
      ) : (
        <p className="synced-block__error">Synced-block context unavailable.</p>
      )}
    </NodeViewWrapper>
  );
}
