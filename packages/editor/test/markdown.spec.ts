import { describe, expect, it } from "vitest";
import { proseMirrorToMarkdown } from "../src/markdown";
import {
  markdownToProseMirror,
  splitMarkdownIntoTree,
  titleFromFilename,
} from "../src/markdownImport";
import type { ProseMirrorNodeJSON } from "../src/references";

const doc = (...content: unknown[]): ProseMirrorNodeJSON =>
  ({ type: "doc", content }) as ProseMirrorNodeJSON;
const para = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (t: string, marks?: unknown[]) => ({ type: "text", text: t, ...(marks ? { marks } : {}) });

describe("proseMirrorToMarkdown", () => {
  it("serializes headings H1-H3", () => {
    const md = proseMirrorToMarkdown(
      doc(
        { type: "heading", attrs: { level: 1 }, content: [text("Title")] },
        { type: "heading", attrs: { level: 2 }, content: [text("Sub")] },
        { type: "heading", attrs: { level: 3 }, content: [text("Deep")] },
      ),
    );
    expect(md).toBe("# Title\n\n## Sub\n\n### Deep");
  });

  it("serializes inline marks", () => {
    const md = proseMirrorToMarkdown(
      doc(
        para(
          text("a "),
          text("bold", [{ type: "bold" }]),
          text(" "),
          text("em", [{ type: "italic" }]),
          text(" "),
          text("code", [{ type: "code" }]),
          text(" "),
          text("link", [{ type: "link", attrs: { href: "https://x.test" } }]),
        ),
      ),
    );
    expect(md).toBe("a **bold** *em* `code` [link](https://x.test)");
  });

  it("serializes bullet, ordered and task lists", () => {
    const bullet = proseMirrorToMarkdown(
      doc({
        type: "bulletList",
        content: [
          { type: "listItem", content: [para(text("one"))] },
          { type: "listItem", content: [para(text("two"))] },
        ],
      }),
    );
    expect(bullet).toBe("- one\n- two");

    const ordered = proseMirrorToMarkdown(
      doc({
        type: "orderedList",
        content: [
          { type: "listItem", content: [para(text("first"))] },
          { type: "listItem", content: [para(text("second"))] },
        ],
      }),
    );
    expect(ordered).toBe("1. first\n2. second");

    const task = proseMirrorToMarkdown(
      doc({
        type: "taskList",
        content: [
          { type: "taskItem", attrs: { checked: true }, content: [para(text("done"))] },
          { type: "taskItem", attrs: { checked: false }, content: [para(text("todo"))] },
        ],
      }),
    );
    expect(task).toBe("- [x] done\n- [ ] todo");
  });

  it("serializes quote, callout (→blockquote) and divider", () => {
    expect(
      proseMirrorToMarkdown(doc({ type: "blockquote", content: [para(text("quoted"))] })),
    ).toBe("> quoted");
    expect(
      proseMirrorToMarkdown(doc({ type: "callout", content: [para(text("note"))] })),
    ).toBe("> note");
    expect(proseMirrorToMarkdown(doc({ type: "horizontalRule" }))).toBe("---");
  });

  it("serializes a code block with language", () => {
    const md = proseMirrorToMarkdown(
      doc({ type: "codeBlock", attrs: { language: "ts" }, content: [text("const x = 1;")] }),
    );
    expect(md).toBe("```ts\nconst x = 1;\n```");
  });

  it("serializes a GFM pipe table", () => {
    const md = proseMirrorToMarkdown(
      doc({
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", content: [para(text("A"))] },
              { type: "tableHeader", content: [para(text("B"))] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [para(text("1"))] },
              { type: "tableCell", content: [para(text("2"))] },
            ],
          },
        ],
      }),
    );
    expect(md).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
  });

  it("serializes images and mention/pageLink as text", () => {
    expect(
      proseMirrorToMarkdown(doc({ type: "image", attrs: { src: "u.png", alt: "cap" } })),
    ).toBe("![cap](u.png)");
    expect(
      proseMirrorToMarkdown(
        doc(
          para(
            { type: "mention", attrs: { kind: "user", id: "u1", label: "Ada" } },
            text(" and "),
            { type: "pageLink", attrs: { pageId: "p1", label: "Specs" } },
          ),
        ),
      ),
    ).toBe("@Ada and Specs");
  });
});

describe("markdownToProseMirror", () => {
  it("parses headings and paragraphs", () => {
    const pm = markdownToProseMirror("# Title\n\nbody text");
    expect(pm.content?.[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
    expect(pm.content?.[1]).toMatchObject({ type: "paragraph" });
  });

  it("parses bullet and ordered lists", () => {
    const pm = markdownToProseMirror("- a\n- b");
    expect(pm.content?.[0]).toMatchObject({ type: "bulletList" });
    const ordered = markdownToProseMirror("1. a\n2. b");
    expect(ordered.content?.[0]).toMatchObject({ type: "orderedList" });
  });

  it("parses GFM task lists", () => {
    const pm = markdownToProseMirror("- [x] done\n- [ ] todo");
    const list = pm.content?.[0] as { type: string; content: { attrs: { checked: boolean } }[] };
    expect(list.type).toBe("taskList");
    expect(list.content[0]?.attrs.checked).toBe(true);
    expect(list.content[1]?.attrs.checked).toBe(false);
  });

  it("parses fenced code blocks with language", () => {
    const pm = markdownToProseMirror("```ts\nconst x = 1;\n```");
    expect(pm.content?.[0]).toMatchObject({ type: "codeBlock", attrs: { language: "ts" } });
  });

  it("parses blockquote, divider and tables", () => {
    expect(markdownToProseMirror("> quoted").content?.[0]).toMatchObject({ type: "blockquote" });
    expect(markdownToProseMirror("---").content?.[0]).toMatchObject({ type: "horizontalRule" });
    const table = markdownToProseMirror("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(table.content?.[0]).toMatchObject({ type: "table" });
  });

  it("preserves inline marks through a round-trip", () => {
    const md = "a **bold** *em* `code` [link](https://x.test)";
    const back = proseMirrorToMarkdown(markdownToProseMirror(md));
    expect(back).toBe(md);
  });
});

describe("splitMarkdownIntoTree", () => {
  it("keeps a single page when there are fewer than two H1s", () => {
    const tree = splitMarkdownIntoTree("notes.md", "# Only\n\nbody");
    expect(tree.title).toBe("Only");
    expect(tree.children).toHaveLength(0);
    expect(tree.doc.content?.[0]).toMatchObject({ type: "paragraph" });
  });

  it("splits each top-level H1 into a child page", () => {
    const md = "intro line\n\n# First\n\nalpha\n\n# Second\n\nbeta";
    const tree = splitMarkdownIntoTree("doc.md", md);
    expect(tree.title).toBe("doc");
    // Preamble (before first H1) stays on the parent.
    expect(tree.doc.content?.[0]).toMatchObject({ type: "paragraph" });
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0]?.title).toBe("First");
    expect(tree.children[1]?.title).toBe("Second");
    expect(tree.children[0]?.doc.content?.[0]).toMatchObject({ type: "paragraph" });
  });

  it("derives a title from the filename", () => {
    expect(titleFromFilename("/tmp/My-Great_Notes.md")).toBe("My Great Notes");
    expect(titleFromFilename("plain")).toBe("plain");
  });
});
