/** A run of snippet text, flagged as a search-match highlight or plain. */
export interface SnippetPart {
  text: string;
  highlight: boolean;
}

/**
 * Parse a search snippet that wraps matched terms in `[[` … `]]` markers into
 * an ordered list of plain/highlight parts. The markers are stripped from the
 * emitted text so the renderer can wrap highlights in `<mark>` safely (no
 * `dangerouslySetInnerHTML`). Unbalanced/empty markers degrade to plain text.
 */
export function parseSnippet(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  const re = /\[\[(.*?)\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(snippet)) !== null) {
    if (m.index > last) {
      parts.push({ text: snippet.slice(last, m.index), highlight: false });
    }
    const matched = m[1] ?? "";
    if (matched.length > 0) {
      parts.push({ text: matched, highlight: true });
    }
    last = re.lastIndex;
  }
  if (last < snippet.length) {
    parts.push({ text: snippet.slice(last), highlight: false });
  }
  return parts;
}
