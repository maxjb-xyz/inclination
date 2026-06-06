import { HocuspocusProvider } from "@hocuspocus/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { pageDocName } from "./docName";
import { buildCollabWsUrl } from "./wsUrl";

/**
 * A live collaboration session for a single page: the Yjs document, the
 * Hocuspocus websocket provider, and the IndexedDB offline persistence, plus a
 * `destroy` that tears all three down. One session exists per open page; it is
 * created fresh when the page changes and destroyed when the page closes — docs
 * are never reused across pages so edits cannot leak between them.
 */
export interface CollabSession {
  pageId: string;
  doc: Y.Doc;
  provider: HocuspocusProvider;
  persistence: IndexeddbPersistence;
  destroy: () => void;
}

export interface CreateCollabSessionOptions {
  pageId: string;
  /** Fresh access token from the auth store, sent to the sync server. */
  token: string;
  /** Override the resolved ws URL (defaults to {@link buildCollabWsUrl}). */
  url?: string;
}

/**
 * Create a collaboration session for a page.
 *
 * The document name MUST be `page:{id}` — the sync server parses the page id
 * out of it for authorization. The token is the API access token; the sync
 * server verifies it and rejects non-members / downgrades to read-only when the
 * user lacks write access. IndexedDB persistence (`page:{id}`) keeps offline
 * edits, which merge back via Yjs on reconnect.
 */
export function createCollabSession(options: CreateCollabSessionOptions): CollabSession {
  const { pageId, token } = options;
  const name = pageDocName(pageId);
  const url = options.url ?? buildCollabWsUrl();

  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(name, doc);
  const provider = new HocuspocusProvider({ url, name, token, document: doc });

  let destroyed = false;
  const destroy = (): void => {
    // Idempotent: a page switch and an unmount can both fire teardown.
    if (destroyed) return;
    destroyed = true;
    provider.destroy();
    void persistence.destroy();
    doc.destroy();
  };

  return { pageId, doc, provider, persistence, destroy };
}
