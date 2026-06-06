/**
 * Yjs document naming convention. MUST stay in sync with the sync server
 * (apps/sync collab.ts `pageIdToDocumentName`): the server parses the page id
 * out of `page:{id}` to authorize the connection, so a mismatch here means
 * every connection is rejected.
 */
export function pageDocName(pageId: string): string {
  return `page:${pageId}`;
}
