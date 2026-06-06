import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { buildBlockExtensions } from "../src/extensions";
import { slashMenuItems } from "../src/slashMenu";

let editor: Editor | undefined;

function makeEditor(): Editor {
  editor = new Editor({ extensions: buildBlockExtensions(), content: "<p></p>" });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

describe("buildBlockExtensions", () => {
  it("returns a non-empty array", () => {
    const exts = buildBlockExtensions();
    expect(Array.isArray(exts)).toBe(true);
    expect(exts.length).toBeGreaterThan(0);
  });

  it("does not include the history extension when collaboration is on (default)", () => {
    const ed = makeEditor();
    // Collaboration owns undo/redo — the local history plugin must be absent.
    expect(ed.extensionManager.extensions.some((e) => e.name === "history")).toBe(false);
  });

  it("registers every expected node in the schema", () => {
    const ed = makeEditor();
    const nodeNames = Object.keys(ed.schema.nodes);
    for (const expected of [
      "paragraph",
      "heading",
      "bulletList",
      "orderedList",
      "listItem",
      "taskList",
      "taskItem",
      "blockquote",
      "callout",
      "horizontalRule",
      "columns",
      "column",
      "tableOfContents",
      "codeBlock",
      "equation",
      "image",
      "fileBlock",
      "videoBlock",
      "bookmark",
      "embed",
      "table",
      "tableRow",
      "tableCell",
      "tableHeader",
      "mention",
      "pageLink",
      "details",
    ]) {
      expect(nodeNames).toContain(expected);
    }
  });
});

/**
 * Drive a Markdown input rule the way ProseMirror does: type the prefix
 * characters, then fire the trigger char through `handleTextInput` (which is
 * what the input-rules plugin listens on). Returns the resulting doc JSON.
 */
function typeWithInputRule(ed: Editor, prefix: string, trigger: string): void {
  ed.commands.setTextSelection(1);
  if (prefix.length > 0) ed.commands.insertContent(prefix);
  const { from, to } = ed.state.selection;
  // someProp("handleTextInput") runs the input-rules plugin's handler.
  ed.view.someProp("handleTextInput", (f) => f(ed.view, from, to, trigger));
}

describe("markdown input rules", () => {
  it("'#' + space converts a paragraph into a level-1 heading", () => {
    const ed = makeEditor();
    typeWithInputRule(ed, "#", " ");
    expect(ed.getJSON().content?.[0]?.type).toBe("heading");
    expect(ed.getJSON().content?.[0]?.attrs?.level).toBe(1);
  });

  it("'>' + space converts a paragraph into a blockquote", () => {
    const ed = makeEditor();
    typeWithInputRule(ed, ">", " ");
    expect(ed.getJSON().content?.[0]?.type).toBe("blockquote");
  });

  it("'-' + space converts a paragraph into a bullet list", () => {
    const ed = makeEditor();
    typeWithInputRule(ed, "-", " ");
    expect(ed.getJSON().content?.[0]?.type).toBe("bulletList");
  });
});

describe("slash menu commands round-trip", () => {
  it("every slash item inserts without throwing and the doc stays valid", () => {
    for (const item of slashMenuItems) {
      const ed = new Editor({ extensions: buildBlockExtensions(), content: "<p></p>" });
      ed.commands.setTextSelection(1);
      expect(() => item.command(ed)).not.toThrow();
      // The document must remain a parseable doc node after insertion.
      expect(ed.getJSON().type).toBe("doc");
      ed.destroy();
    }
  });

  it("the callout slash command produces a callout node", () => {
    const ed = makeEditor();
    ed.commands.setTextSelection(1);
    ed.commands.insertContent("hi");
    const callout = slashMenuItems.find((i) => i.id === "callout")!;
    callout.command(ed);
    const types = (ed.getJSON().content ?? []).map((n) => n.type);
    expect(types).toContain("callout");
  });

  it("the equation slash command produces an equation node carrying latex attr", () => {
    const ed = makeEditor();
    ed.commands.setTextSelection(1);
    ed.chain().focus().setEquation("E = mc^2").run();
    const eq = (ed.getJSON().content ?? []).find((n) => n.type === "equation");
    expect(eq).toBeDefined();
    expect(eq?.attrs?.latex).toBe("E = mc^2");
  });
});
