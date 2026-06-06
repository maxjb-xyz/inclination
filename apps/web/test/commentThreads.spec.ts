import { describe, expect, it } from "vitest";
import {
  buildCommentBody,
  groupThreads,
  renderCommentText,
} from "../src/collab/commentThreads";
import type { CommentWithAuthor } from "../src/api/collabTypes";

function comment(over: Partial<CommentWithAuthor>): CommentWithAuthor {
  return {
    id: "c",
    pageId: "p",
    blockAnchor: null,
    threadId: "c",
    parentCommentId: null,
    authorId: "u",
    body: { type: "doc", content: [] },
    resolvedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    author: { id: "u", displayName: "User", avatarUrl: null },
    ...over,
  };
}

describe("groupThreads", () => {
  it("groups a root + replies by threadId with the root first", () => {
    const root = comment({ id: "r1", threadId: "r1", createdAt: "2026-01-01T00:00:01.000Z" });
    const reply = comment({
      id: "r2",
      threadId: "r1",
      parentCommentId: "r1",
      createdAt: "2026-01-01T00:00:02.000Z",
    });
    const other = comment({ id: "o1", threadId: "o1", createdAt: "2026-01-01T00:00:03.000Z" });

    const threads = groupThreads([reply, root, other]);
    expect(threads).toHaveLength(2);
    expect(threads[0]!.root.id).toBe("r1");
    expect(threads[0]!.replies.map((c) => c.id)).toEqual(["r2"]);
    expect(threads[0]!.comments.map((c) => c.id)).toEqual(["r1", "r2"]);
    expect(threads[1]!.root.id).toBe("o1");
  });

  it("marks a thread resolved when the root has resolvedAt and surfaces the anchor", () => {
    const root = comment({
      id: "r1",
      threadId: "r1",
      resolvedAt: "2026-01-02T00:00:00.000Z",
      blockAnchor: { blockId: "b", from: 1, to: 4 },
    });
    const [thread] = groupThreads([root]);
    expect(thread!.resolved).toBe(true);
    expect(thread!.anchor).toEqual({ blockId: "b", from: 1, to: 4 });
  });
});

describe("buildCommentBody / renderCommentText", () => {
  it("builds a ProseMirror body with text + a user mention node", () => {
    const body = buildCommentBody([
      { type: "text", text: "hey " },
      { type: "mention", id: "u9", label: "Alice" },
    ]);
    const content = (body.content as { content: unknown[] }[])[0]!.content as {
      type: string;
      attrs?: { kind?: string; id?: string };
    }[];
    expect(content[0]).toMatchObject({ type: "text" });
    expect(content[1]).toMatchObject({ type: "mention", attrs: { kind: "user", id: "u9" } });
  });

  it("renders text + @label back to a flat string", () => {
    const body = buildCommentBody([
      { type: "text", text: "ping " },
      { type: "mention", id: "u9", label: "Alice" },
    ]);
    expect(renderCommentText(body)).toBe("ping @Alice");
  });
});
