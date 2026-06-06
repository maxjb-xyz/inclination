import { describe, expect, it } from "vitest";
import { extractMentionedUserIds, replyRecipientIds, type RichTextNode } from "../src/comments/mentions";
import { resolveThreadId } from "../src/comments/thread";

describe("resolveThreadId", () => {
  it("a top-level comment becomes its own thread root", () => {
    expect(resolveThreadId("c1", null)).toBe("c1");
    expect(resolveThreadId("c1", undefined)).toBe("c1");
  });

  it("a reply inherits the parent's threadId", () => {
    expect(resolveThreadId("c2", "thread-root")).toBe("thread-root");
  });
});

describe("extractMentionedUserIds", () => {
  const mention = (kind: string, id: string): RichTextNode => ({
    type: "mention",
    attrs: { kind, id },
  });

  it("collects user mentions and ignores page mentions", () => {
    const body: RichTextNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text" },
            mention("user", "u1"),
            mention("page", "p1"),
            mention("user", "u2"),
          ],
        },
      ],
    };
    expect(extractMentionedUserIds(body)).toEqual(["u1", "u2"]);
  });

  it("dedupes repeated user mentions, first-seen order", () => {
    const body: RichTextNode = {
      type: "doc",
      content: [mention("user", "u1"), mention("user", "u1"), mention("user", "u2")],
    };
    expect(extractMentionedUserIds(body)).toEqual(["u1", "u2"]);
  });

  it("returns empty for null/empty/no-mention bodies", () => {
    expect(extractMentionedUserIds(null)).toEqual([]);
    expect(extractMentionedUserIds({})).toEqual([]);
    expect(
      extractMentionedUserIds({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text" }] }] }),
    ).toEqual([]);
  });

  it("ignores mention nodes with a missing/blank id", () => {
    const body: RichTextNode = {
      type: "doc",
      content: [{ type: "mention", attrs: { kind: "user", id: "" } }, mention("user", "u3")],
    };
    expect(extractMentionedUserIds(body)).toEqual(["u3"]);
  });
});

describe("replyRecipientIds", () => {
  it("notifies the thread root author plus distinct prior participants, minus the replier", () => {
    // thread: root by A, replies by B and C; D replies now.
    const out = replyRecipientIds("D", "A", ["A", "B", "C"]);
    expect(out).toEqual(["A", "B", "C"]);
  });

  it("excludes the replier even if they participated earlier", () => {
    // B replies again to a thread rooted by A where B already commented.
    const out = replyRecipientIds("B", "A", ["A", "B"]);
    expect(out).toEqual(["A"]);
  });

  it("dedupes; root author appears once and first", () => {
    const out = replyRecipientIds("C", "A", ["A", "A", "B"]);
    expect(out).toEqual(["A", "B"]);
  });

  it("returns empty when the replier is the only participant (self-reply)", () => {
    expect(replyRecipientIds("A", "A", ["A"])).toEqual([]);
  });
});
