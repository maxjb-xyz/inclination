import * as Y from "yjs";

/**
 * Yjs → plain-text extraction for the search index (spec §6: "On save, plain
 * text is extracted from the doc and written to SearchIndex").
 *
 * The page body is a Tiptap/ProseMirror document bound to Yjs by `y-prosemirror`
 * via the Collaboration extension, which stores the block tree under the XML
 * fragment field named `default` (the Collaboration extension's default
 * `field`). The tree is a `Y.XmlFragment` of `Y.XmlElement` nodes (paragraphs,
 * headings, list items, …) with `Y.XmlText` leaves carrying the actual text.
 *
 * We walk that fragment depth-first and concatenate the text, inserting a space
 * at block boundaries so adjacent blocks' words don't fuse ("foobar" vs
 * "foo bar"). The function is intentionally PURE (Doc in, string out) and side
 * effect free so it can be unit-tested without any database or websocket.
 */

/** The XML fragment field Tiptap's Collaboration extension binds to by default. */
export const PROSE_FRAGMENT_FIELD = "default";

/** Cap extracted text so a pathologically large doc can't blow up the index row. */
export const MAX_EXTRACTED_CHARS = 100_000;

/**
 * Walk a Yjs XML node (fragment / element / text) accumulating its text into
 * `parts`. Block-level elements push a separator so words across blocks stay
 * separated. Recursion is bounded only by the doc's own nesting; Yjs trees are
 * shallow in practice.
 */
function collectText(node: Y.XmlFragment | Y.XmlElement | Y.XmlText, parts: string[]): void {
  if (node instanceof Y.XmlText) {
    const s = node.toString();
    if (s) parts.push(s);
    return;
  }
  // Fragment or element: recurse over children, separating blocks by a space.
  const children = node.toArray();
  for (const child of children) {
    collectText(child as Y.XmlFragment | Y.XmlElement | Y.XmlText, parts);
    // After each child of a container, add a soft boundary so block text doesn't
    // run together. Collapsed later by normaliseWhitespace.
    parts.push(" ");
  }
}

/** Collapse runs of whitespace to single spaces and trim. */
function normaliseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Extract concatenated plain text from a Yjs page document. Reads the prose XML
 * fragment (`default`) and returns whitespace-normalised text, capped at
 * {@link MAX_EXTRACTED_CHARS}. Returns "" for an empty/blank doc.
 */
export function extractPlainText(doc: Y.Doc): string {
  const fragment = doc.getXmlFragment(PROSE_FRAGMENT_FIELD);
  const parts: string[] = [];
  collectText(fragment, parts);
  const text = normaliseWhitespace(parts.join(""));
  return text.length > MAX_EXTRACTED_CHARS ? text.slice(0, MAX_EXTRACTED_CHARS) : text;
}

/**
 * Decode a stored Yjs update binary into a fresh `Y.Doc` and extract its plain
 * text. Resilient: any decode failure yields "" rather than throwing, so a
 * corrupt/legacy state can never break the persistence path that calls it.
 */
export function extractPlainTextFromUpdate(state: Uint8Array): string {
  try {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const text = extractPlainText(doc);
    doc.destroy();
    return text;
  } catch {
    return "";
  }
}
