import type { PublishPageInput } from "@inclination/shared";
import type { ApiClient } from "./apiClient";
import type {
  ImportedTree,
  MarkdownExport,
  PublicPage,
  PublicShareSettings,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

/**
 * Phase 8 REST surface — publishing, Markdown import/export, synced-block create.
 * Parameterised by an {@link ApiClient} for testability (the authed endpoints go
 * through the shared client so Bearer-token + refresh handling is reused).
 */
export function createPublishingApi(client: ApiClient) {
  return {
    /** Current publish settings (or null if never published). */
    getPublicShare: (pageId: string) =>
      client.get<PublicShareSettings | null>(`/pages/${pageId}/public-share`),

    /** Publish (or re-publish) — sends the editor-serialized HTML snapshot + title. */
    publish: (pageId: string, body: PublishPageInput) =>
      client.post<PublicShareSettings>(`/pages/${pageId}/publish`, body),

    /** Unpublish — hides the public page (keeps the slug). */
    unpublish: (pageId: string) =>
      client.post<PublicShareSettings | { published: false }>(`/pages/${pageId}/unpublish`),

    /** Server-side Markdown export of a page's body. */
    exportMarkdown: (pageId: string) =>
      client.get<MarkdownExport>(`/pages/${pageId}/export/markdown`),

    /** Import a Markdown document into a workspace → the created page tree. */
    importMarkdown: (wsId: string, filename: string, markdown: string) =>
      client.post<ImportedTree>(`/workspaces/${wsId}/import/markdown`, { filename, markdown }),

    /** Create a synced block in a workspace → its id (its own Yjs doc `synced:{id}`). */
    createSyncedBlock: (wsId: string) =>
      client.post<{ id: string }>(`/workspaces/${wsId}/synced-blocks`),
  };
}

export type PublishingApi = ReturnType<typeof createPublishingApi>;

/**
 * Fetch a published page by slug WITHOUT authentication.
 *
 * The public route renders for logged-out visitors, so this deliberately does
 * NOT go through the authed {@link ApiClient} (no Bearer token, no refresh). It
 * hits `GET /api/public/:slug` directly. A 404 (unpublished/unknown slug) throws
 * so the caller can render a "not found" state.
 *
 * @param fetchImpl injected for tests; defaults to the global fetch.
 */
export async function fetchPublicPage(
  slug: string,
  fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args),
): Promise<PublicPage> {
  const res = await fetchImpl(`${API_BASE}/public/${encodeURIComponent(slug)}`);
  if (!res.ok) {
    throw new Error(res.status === 404 ? "not-found" : `Request failed (${res.status})`);
  }
  return (await res.json()) as PublicPage;
}
