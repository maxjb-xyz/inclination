import { describe, expect, it } from "vitest";
import { extractPageReferences } from "../src/references";

describe("extractPageReferences", () => {
  it("collects pageLink.pageId and page-mention id, deduped, ignoring user mentions", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "see " },
            { type: "pageLink", attrs: { pageId: "page-a", label: "A" } },
            { type: "text", text: " and " },
            { type: "mention", attrs: { kind: "page", id: "page-b", label: "B" } },
          ],
        },
        {
          type: "callout",
          content: [
            {
              type: "paragraph",
              content: [
                // duplicate of page-a — must be deduped
                { type: "pageLink", attrs: { pageId: "page-a", label: "A again" } },
                // user mention — must be excluded
                { type: "mention", attrs: { kind: "user", id: "user-1", label: "Alice" } },
                // nested page mention
                { type: "mention", attrs: { kind: "page", id: "page-c", label: "C" } },
              ],
            },
          ],
        },
      ],
    };

    const refs = extractPageReferences(doc);

    expect(refs).toEqual(["page-a", "page-b", "page-c"]);
  });

  it("returns an empty array for an empty / missing doc", () => {
    expect(extractPageReferences(null)).toEqual([]);
    expect(extractPageReferences({ type: "doc" })).toEqual([]);
    expect(extractPageReferences({ type: "doc", content: [] })).toEqual([]);
  });

  it("skips nodes with missing ids", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "pageLink", attrs: { label: "no id" } },
        { type: "mention", attrs: { kind: "page", label: "no id" } },
        { type: "pageLink", attrs: { pageId: "ok" } },
      ],
    };
    expect(extractPageReferences(doc)).toEqual(["ok"]);
  });
});
