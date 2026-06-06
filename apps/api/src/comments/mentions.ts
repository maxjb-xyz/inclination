/**
 * Pure helpers for comment notification fan-out (spec §6). Kept side-effect-free
 * so the thread-id, mention-extraction and reply-recipient logic is exhaustively
 * unit-testable without a database.
 *
 * The comment `body` is rich-text JSON (the same ProseMirror/Tiptap shape the
 * editor produces). A user `@`-mention is a `mention` node with
 * `attrs: { kind: "user", id, label? }` — mirroring the mentionable shape used
 * for backlinks (`{ kind: 'user' | 'page', id, label }`). Page mentions are
 * ignored here (they drive backlinks, not notifications).
 */

/** A minimal structural view of a ProseMirror/Tiptap JSON node. */
export interface RichTextNode {
  type?: string;
  attrs?: Record<string, unknown> | null;
  content?: RichTextNode[];
}

/**
 * Collect the distinct user ids `@`-mentioned in a comment body. Only
 * `mention` nodes with `kind: "user"` count; page mentions are skipped. Result
 * preserves first-seen order and is deduplicated.
 */
export function extractMentionedUserIds(
  body: RichTextNode | null | undefined,
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  const walk = (node: RichTextNode | null | undefined): void => {
    if (!node || typeof node !== "object") return;
    const attrs = node.attrs ?? undefined;
    if (node.type === "mention" && attrs && attrs.kind === "user") {
      const id = attrs.id;
      if (typeof id === "string" && id.length > 0 && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
  };

  walk(body);
  return ids;
}

/**
 * Compute who should be notified of a reply (type `comment_reply`): the thread
 * root author plus every distinct prior participant in the thread, minus the
 * replier themselves. Order: root author first (if not the replier), then the
 * remaining participants in first-seen order. Deduplicated.
 *
 * @param replierId        the author of the new reply
 * @param threadRootAuthorId author of the thread root comment
 * @param priorAuthorIds   author ids of existing comments in the thread (any order)
 */
export function replyRecipientIds(
  replierId: string,
  threadRootAuthorId: string,
  priorAuthorIds: readonly string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>([replierId]);

  const add = (id: string): void => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };

  add(threadRootAuthorId);
  for (const id of priorAuthorIds) add(id);
  return out;
}
