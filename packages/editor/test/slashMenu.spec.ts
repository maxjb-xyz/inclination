import { describe, expect, it } from "vitest";
import { filterSlashMenuItems, slashMenuItems } from "../src/slashMenu";

const EXPECTED_IDS = [
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "bulletList",
  "orderedList",
  "toggleList",
  "taskList",
  "quote",
  "callout",
  "divider",
  "columns",
  "tableOfContents",
  "codeBlock",
  "equation",
  "image",
  "file",
  "video",
  "bookmark",
  "embed",
  "table",
  "pageLink",
  "mention",
] as const;

describe("slashMenuItems", () => {
  it("covers every block type from the spec block set", () => {
    const ids = slashMenuItems.map((i) => i.id);
    for (const expected of EXPECTED_IDS) {
      expect(ids).toContain(expected);
    }
  });

  it("has unique ids and a command function for each item", () => {
    const ids = slashMenuItems.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of slashMenuItems) {
      expect(typeof item.command).toBe("function");
      expect(item.title.length).toBeGreaterThan(0);
    }
  });
});

describe("filterSlashMenuItems", () => {
  it("returns all items for an empty query", () => {
    expect(filterSlashMenuItems("")).toHaveLength(slashMenuItems.length);
  });

  it("matches on title (case-insensitive)", () => {
    const result = filterSlashMenuItems("Heading");
    expect(result.map((i) => i.id)).toEqual(
      expect.arrayContaining(["heading1", "heading2", "heading3"]),
    );
  });

  it("matches on keywords", () => {
    const result = filterSlashMenuItems("todo");
    expect(result.map((i) => i.id)).toContain("taskList");
  });

  it("matches on keywords for code", () => {
    const result = filterSlashMenuItems("```");
    expect(result.map((i) => i.id)).toContain("codeBlock");
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterSlashMenuItems("zzzznomatch")).toEqual([]);
  });
});
