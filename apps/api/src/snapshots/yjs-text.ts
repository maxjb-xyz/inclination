import * as Y from "yjs";

/**
 * Yjs → plain-text extraction for snapshot previews. This mirrors the sync
 * server's `extract.ts` walker (apps/sync) — the API cannot import across the
 * app boundary, so the small, pure walker is duplicated here. Full decode to
 * ProseMirror JSON requires the editor schema (y-prosemirror, web-only), so the
 * API offers a plain-text preview instead and flags `decoded: false`; the web
 * version-history panel can render a richer preview by binding the bytes to a
 * read-only editor (T2).
 */

/** The XML fragment field Tiptap's Collaboration extension binds to by default. */
export const PROSE_FRAGMENT_FIELD = "default";

/** Cap preview text so a pathologically large doc can't blow up a response. */
export const MAX_PREVIEW_CHARS = 20_000;

function collectText(
  node: Y.XmlFragment | Y.XmlElement | Y.XmlText,
  parts: string[],
): void {
  if (node instanceof Y.XmlText) {
    const s = node.toString();
    if (s) parts.push(s);
    return;
  }
  const children = node.toArray();
  for (const child of children) {
    collectText(child as Y.XmlFragment | Y.XmlElement | Y.XmlText, parts);
    parts.push(" ");
  }
}

function normaliseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Decode a stored Yjs update binary and extract its plain text. Resilient: any
 * decode failure yields "" rather than throwing, so a corrupt/legacy snapshot
 * never breaks the preview endpoint.
 */
export function snapshotPreviewText(state: Uint8Array): string {
  try {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const fragment = doc.getXmlFragment(PROSE_FRAGMENT_FIELD);
    const parts: string[] = [];
    collectText(fragment, parts);
    const text = normaliseWhitespace(parts.join(""));
    doc.destroy();
    return text.length > MAX_PREVIEW_CHARS ? text.slice(0, MAX_PREVIEW_CHARS) : text;
  } catch {
    return "";
  }
}
