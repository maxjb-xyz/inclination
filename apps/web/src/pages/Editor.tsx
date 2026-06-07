import "katex/dist/katex.min.css";
// Code blocks use a dark surface (--code-bg) in both themes, so pair them with
// the dark highlight.js theme for readable token colors.
import "highlight.js/styles/github-dark.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { EditorContent, useEditor } from "@tiptap/react";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import type { CollabSession } from "../collab/session";
import { apiClient } from "../api/apiClient";
import { createPagesApi } from "../api/pagesApi";
import { createPublishingApi } from "../api/publishingApi";
import { buildWebExtensions } from "../editor/extensions";
import { BlockHandle } from "../editor/BlockHandle";
import { OpenPageContext, type OpenPageHandler } from "../editor/openPageContext";
import { DatabaseEditorContext } from "../editor/databaseContext";
import { SyncedBlockEditorContext } from "../editor/syncedBlockContext";
import { UploadEditorContext } from "../editor/uploadContext";
import { createDbApi } from "../databases/dbApi";
import {
  buildMentionSuggestion,
  buildPageLinkSuggestion,
} from "../editor/mentionSuggestion";
import { useReferenceSync } from "../editor/useReferenceSync";

const pagesApi = createPagesApi(apiClient);
const dbApi = createDbApi(apiClient);
const publishingApi = createPublishingApi(apiClient);

export interface CollabUser {
  /** Display name shown on the remote caret label. */
  name: string;
  /** Stable presence color (see collab/color.ts). */
  color: string;
}

/** A captured inline-comment anchor: the selected text + its block/range. */
export interface InlineCommentAnchor {
  blockId: string;
  from: number;
  to: number;
  text: string;
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
  /** Active workspace id — scopes the `@`/`[[` mentionable search. */
  workspaceId: string;
  /** Open-page navigation for pageLink / page-mention clicks. */
  onOpenPage: OpenPageHandler;
  /** When false the editor is rendered read-only (no edit affordances). */
  editable?: boolean;
  /** Invoked when the user clicks "Comment" over a non-empty text selection. */
  onCommentOnSelection?: (anchor: InlineCommentAnchor) => void;
  /**
   * Access token for nested synced-block collaboration sessions (`synced:{id}`).
   * Defaults to "" — synced blocks then render but cannot open a live session.
   */
  token?: string;
  /**
   * Receives the live Tiptap editor instance once built (and null on unmount).
   * The page uses it to serialize the doc to HTML for publishing.
   */
  onEditorReady?: (editor: ReturnType<typeof useEditor>) => void;
}

/**
 * Collaborative Tiptap editor bound to a Yjs document, with the full §7 block
 * set (slash menu, all block types, Markdown shortcuts) wired in, plus the
 * `@`-mention / `[[`-page-link autocomplete and backlink reference syncing.
 *
 * Block extensions come from `@inclination/editor` via {@link buildWebExtensions}
 * with `collaboration: true`, so no local history runs — the Collaboration
 * extension supplies Yjs-aware undo/redo. CollaborationCursor renders remote
 * carets. A custom {@link BlockHandle} overlay provides drag/duplicate/delete/
 * turn-into. The editor is keyed on the doc identity (via the `useEditor` deps)
 * so switching pages rebuilds it against the new doc.
 *
 * The mention/page-link suggestion configs are injected here (they need the
 * apiClient + workspace id); the active workspace is read lazily at query time.
 */
export function Editor({
  session,
  user,
  workspaceId,
  onOpenPage,
  editable = true,
  onCommentOnSelection,
  token = "",
  onEditorReady,
}: EditorProps): React.ReactElement {
  const { doc, provider } = session;
  const [selection, setSelection] = useState<InlineCommentAnchor | null>(null);

  // Keep the current workspace id in a ref so suggestion query closures always
  // read the latest value. A workspace switch without a doc swap does NOT rebuild
  // the editor (it is keyed only on [doc, provider]), so the suggestion configs
  // must not close over a stale `workspaceId` — the ref keeps them correct.
  const workspaceIdRef = useRef(workspaceId);
  workspaceIdRef.current = workspaceId;

  // Suggestion configs are stable for the lifetime of this editor; the workspace
  // id is resolved lazily via the ref so it always reflects the current value.
  const { mentionSuggestion, pageLinkSuggestion } = useMemo(() => {
    const deps = { api: pagesApi, getWorkspaceId: () => workspaceIdRef.current };
    return {
      mentionSuggestion: buildMentionSuggestion(deps),
      pageLinkSuggestion: buildPageLinkSuggestion(deps),
    };
  }, []);

  const editor = useEditor(
    {
      editable,
      extensions: [
        // Full §7 block set; history off (Collaboration owns undo/redo).
        ...buildWebExtensions({ collaboration: true, mentionSuggestion, pageLinkSuggestion }),
        Collaboration.configure({ document: doc }),
        CollaborationCursor.configure({ provider, user }),
      ],
      // Surface the current text selection so the page can offer an inline
      // "Comment" action. We capture the block's start position as a stable-ish
      // `blockId` plus the document `from`/`to` (a robust-enough anchor — full
      // ProseMirror mark-based anchoring is heavier than this phase needs).
      onSelectionUpdate: ({ editor: e }) => {
        const { from, to, empty } = e.state.selection;
        if (empty || !onCommentOnSelection) {
          setSelection(null);
          return;
        }
        const $from = e.state.doc.resolve(from);
        const blockStart = $from.start($from.depth);
        setSelection({
          blockId: String(blockStart),
          from,
          to,
          text: e.state.doc.textBetween(from, to, " "),
        });
      },
    },
    // Rebuild the editor whenever the underlying doc/provider changes (page
    // switch). Without this, a stale editor would stay bound to the old doc.
    [doc, provider, editable],
  );

  // Sync referenced page ids (backlinks) to the API on debounced doc changes.
  useReferenceSync(editor, session.pageId, (id, ids) => pagesApi.putReferences(id, ids));

  // Surface the editor instance to the page (used to serialize HTML to publish).
  // Re-runs whenever the editor is rebuilt; clears on unmount.
  useEffect(() => {
    onEditorReady?.(editor);
    return () => onEditorReady?.(null);
  }, [editor, onEditorReady]);

  // Context for inline database blocks: create a new database parented under
  // this page, returning its id for the node to render.
  const databaseContext = useMemo(
    () => ({
      workspaceId,
      createDatabase: async (): Promise<string> => {
        const db = await dbApi.createDatabase(workspaceIdRef.current, {
          parentId: session.pageId,
          title: "Untitled database",
        });
        return db.pageId;
      },
    }),
    [workspaceId, session.pageId],
  );

  const uploadContext = useMemo(
    () => ({ workspaceId, pageId: session.pageId }),
    [workspaceId, session.pageId],
  );

  // Context for the synced-block NodeView: create one on demand + the token/user
  // it needs to open the nested `synced:{id}` collaboration session.
  const syncedBlockContext = useMemo(
    () => ({
      workspaceId,
      token,
      userName: user.name,
      userColor: user.color,
      createSyncedBlock: async (): Promise<string> => {
        const block = await publishingApi.createSyncedBlock(workspaceIdRef.current);
        return block.id;
      },
    }),
    [workspaceId, token, user.name, user.color],
  );

  return (
    <OpenPageContext.Provider value={onOpenPage}>
      <DatabaseEditorContext.Provider value={databaseContext}>
       <SyncedBlockEditorContext.Provider value={syncedBlockContext}>
       <UploadEditorContext.Provider value={uploadContext}>
        <div className="editor" data-testid="editor">
          {editor && editable ? <BlockHandle editor={editor} /> : null}
          {selection && onCommentOnSelection ? (
            <button
              type="button"
              className="inline-comment-button"
              data-testid="inline-comment-button"
              onMouseDown={(e) => {
                e.preventDefault();
                onCommentOnSelection(selection);
                setSelection(null);
              }}
            >
              <MessageSquarePlus size={15} />
              Comment
            </button>
          ) : null}
          <EditorContent editor={editor} />
        </div>
       </UploadEditorContext.Provider>
       </SyncedBlockEditorContext.Provider>
      </DatabaseEditorContext.Provider>
    </OpenPageContext.Provider>
  );
}
