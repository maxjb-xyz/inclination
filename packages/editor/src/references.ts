/**
 * Pure utilities for extracting page references out of a ProseMirror/Tiptap
 * document JSON. Used by the web app to sync the backlink set (Phase 4 gate:
 * mentioning a page creates a working backlink) without coupling the editor
 * package to the network layer.
 */

/** A minimal structural view of a ProseMirror JSON node. */
export interface ProseMirrorNodeJSON {
  type?: string;
  attrs?: Record<string, unknown> | null;
  content?: ProseMirrorNodeJSON[];
}

/**
 * Collect the set of page ids referenced by a document: every `pageLink`
 * node's `pageId` plus every page-kind `mention` node's `id`. User mentions are
 * ignored. The result is deduplicated while preserving first-seen order.
 */
export function extractPageReferences(doc: ProseMirrorNodeJSON | null | undefined): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  const push = (value: unknown): void => {
    if (typeof value !== "string" || value.length === 0) return;
    if (seen.has(value)) return;
    seen.add(value);
    ids.push(value);
  };

  const walk = (node: ProseMirrorNodeJSON | null | undefined): void => {
    if (!node || typeof node !== "object") return;
    const attrs = node.attrs ?? undefined;
    if (node.type === "pageLink" && attrs) {
      push(attrs.pageId);
    } else if (node.type === "mention" && attrs && attrs.kind === "page") {
      push(attrs.id);
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
  };

  walk(doc);
  return ids;
}
