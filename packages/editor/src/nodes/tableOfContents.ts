import { mergeAttributes, Node } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tableOfContents: {
      /** Insert a table-of-contents placeholder block. */
      setTableOfContents: () => ReturnType;
    };
  }
}

/**
 * Table of contents — an atom block. The actual heading list is derived from
 * the document by the web app's NodeView; the node itself just marks the
 * insertion point so it round-trips through Yjs.
 */
export const TableOfContents = Node.create({
  name: "tableOfContents",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  parseHTML() {
    return [{ tag: 'div[data-type="table-of-contents"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "table-of-contents" }),
      "Table of contents",
    ];
  },

  addCommands() {
    return {
      setTableOfContents:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    };
  },
});
