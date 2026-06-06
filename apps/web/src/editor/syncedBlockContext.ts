import { createContext, useContext } from "react";

/**
 * Context for the `syncedBlock` NodeView: it needs the active workspace id +
 * access token (to open the nested `synced:{id}` collaboration session) and a
 * way to create a new synced block on demand (the "Synced block" slash action
 * inserts an empty node and then fills in the created id).
 */
export interface SyncedBlockEditorContextValue {
  workspaceId: string;
  /** Fresh access token for the nested collab provider. */
  token: string;
  /** Display name shown on the nested editor's remote carets. */
  userName: string;
  /** Stable presence color for the nested editor's remote caret. */
  userColor: string;
  /** Create a new synced block in the workspace; resolves to its id. */
  createSyncedBlock: () => Promise<string>;
}

export const SyncedBlockEditorContext = createContext<SyncedBlockEditorContextValue | null>(null);

export function useSyncedBlockEditorContext(): SyncedBlockEditorContextValue | null {
  return useContext(SyncedBlockEditorContext);
}
