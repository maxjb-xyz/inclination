import type { CommentWithAuthor } from "../api/collabTypes";

/** A grouped comment thread: the root comment + its replies, in time order. */
export interface CommentThread {
  threadId: string;
  root: CommentWithAuthor;
  replies: CommentWithAuthor[];
  /** All comments in the thread (root first), time-ordered. */
  comments: CommentWithAuthor[];
  resolved: boolean;
  /** The inline anchor of the root, if this is an anchored thread. */
  anchor: CommentWithAuthor["blockAnchor"];
}

/**
 * Group a flat, time-ordered comment list into threads keyed by `threadId`. The
 * root is the comment whose id === threadId (falling back to the earliest in the
 * group). A thread is `resolved` when its root carries `resolvedAt`. Threads are
 * returned in root-creation order.
 */
export function groupThreads(comments: CommentWithAuthor[]): CommentThread[] {
  const byThread = new Map<string, CommentWithAuthor[]>();
  for (const c of comments) {
    const list = byThread.get(c.threadId);
    if (list) list.push(c);
    else byThread.set(c.threadId, [c]);
  }

  const threads: CommentThread[] = [];
  for (const [threadId, group] of byThread) {
    const ordered = [...group].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const root = ordered.find((c) => c.id === threadId) ?? ordered[0]!;
    const replies = ordered.filter((c) => c.id !== root.id);
    threads.push({
      threadId,
      root,
      replies,
      comments: [root, ...replies],
      resolved: root.resolvedAt !== null,
      anchor: root.blockAnchor,
    });
  }

  threads.sort((a, b) => a.root.createdAt.localeCompare(b.root.createdAt));
  return threads;
}

/** A token used by the comment composer: plain text or a user mention. */
export type CommentToken =
  | { type: "text"; text: string }
  | { type: "mention"; id: string; label: string };

/**
 * Build a ProseMirror/Tiptap-shaped rich-text body from composer tokens. The
 * API's mention extractor looks for `mention` nodes with `attrs.kind === "user"`
 * → these notify the mentioned users. An all-text body is valid too.
 */
export function buildCommentBody(tokens: CommentToken[]): Record<string, unknown> {
  const content = tokens
    .filter((t) => (t.type === "text" ? t.text.length > 0 : true))
    .map((t) =>
      t.type === "text"
        ? { type: "text", text: t.text }
        : { type: "mention", attrs: { kind: "user", id: t.id, label: t.label } },
    );
  return {
    type: "doc",
    content: [{ type: "paragraph", content: content.length ? content : [] }],
  };
}

/**
 * Render a comment body back to a flat display string (text + `@label` for user
 * mentions). Best-effort: walks the node tree collecting `text` and mention
 * labels. Used by the panel to show comment contents without a full editor.
 */
export function renderCommentText(body: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; text?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    if (n.type === "text" && typeof n.text === "string") parts.push(n.text);
    if (n.type === "mention" && n.attrs && typeof n.attrs.label === "string") {
      parts.push(`@${n.attrs.label}`);
    }
    if (Array.isArray(n.content)) for (const child of n.content) walk(child);
  };
  walk(body);
  return parts.join("").trim();
}
