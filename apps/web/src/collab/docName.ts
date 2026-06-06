/**
 * Yjs document naming convention. MUST stay in sync with the sync server
 * (apps/sync collab.ts `pageIdToDocumentName`): the server parses the page id
 * out of `page:{id}` to authorize the connection, so a mismatch here means
 * every connection is rejected.
 */
export function pageDocName(pageId: string): string {
  return `page:${pageId}`;
}

/**
 * Synced-block document naming convention. MUST stay in sync with the sync
 * server (apps/sync), which parses the synced-block id out of `synced:{id}` to
 * authorize the connection against the block's workspace. A SyncedBlock has its
 * OWN Yjs doc keyed this way; the same id embedded on two pages → same doc.
 */
export function syncedDocName(syncedBlockId: string): string {
  return `synced:${syncedBlockId}`;
}
