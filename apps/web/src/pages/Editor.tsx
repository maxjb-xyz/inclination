import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";
import { useMemo, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import type { CollabSession } from "../collab/session";
import { apiClient } from "../api/apiClient";
import { createPagesApi } from "../api/pagesApi";
import { buildWebExtensions } from "../editor/extensions";
import { BlockHandle } from "../editor/BlockHandle";
import { OpenPageContext, type OpenPageHandler } from "../editor/openPageContext";
import {
  buildMentionSuggestion,
  buildPageLinkSuggestion,
} from "../editor/mentionSuggestion";
import { useReferenceSync } from "../editor/useReferenceSync";

const pagesApi = createPagesApi(apiClient);

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
  /** Active workspace id — scopes the `@`/`[[` mentionable search. */
  workspaceId: string;
  /** Open-page navigation for pageLink / page-mention clicks. */
  onOpenPage: OpenPageHandler;
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
}: EditorProps): React.ReactElement {
  const { doc, provider } = session;

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
      extensions: [
        // Full §7 block set; history off (Collaboration owns undo/redo).
        ...buildWebExtensions({ collaboration: true, mentionSuggestion, pageLinkSuggestion }),
        Collaboration.configure({ document: doc }),
        CollaborationCursor.configure({ provider, user }),
      ],
    },
    // Rebuild the editor whenever the underlying doc/provider changes (page
    // switch). Without this, a stale editor would stay bound to the old doc.
    [doc, provider],
  );

  // Sync referenced page ids (backlinks) to the API on debounced doc changes.
  useReferenceSync(editor, session.pageId, (id, ids) => pagesApi.putReferences(id, ids));

  return (
    <OpenPageContext.Provider value={onOpenPage}>
      <div className="editor" data-testid="editor">
        {editor ? <BlockHandle editor={editor} /> : null}
        <EditorContent editor={editor} />
      </div>
    </OpenPageContext.Provider>
  );
}
