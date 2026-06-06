import { mergeAttributes, Node } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    columns: {
      /** Insert a columns container with `count` empty columns (default 2). */
      setColumns: (count?: number) => ReturnType;
    };
  }
}

/**
 * A single column inside a {@link Columns} container. Holds block content.
 * `data-type="column"` so it round-trips through Yjs without a NodeView.
 */
export const Column = Node.create({
  name: "column",
  group: "column",
  content: "block+",
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "column" }), 0];
  },
});

/**
 * Columns container — a horizontal row of {@link Column} children. The web app
 * lays them out with flexbox via the `data-type="columns"` selector.
 */
export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column{2,}",
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="columns"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "columns" }), 0];
  },

  addCommands() {
    return {
      setColumns:
        (count = 2) =>
        ({ commands }) => {
          const columns = Array.from({ length: Math.max(2, count) }, () => ({
            type: "column",
            content: [{ type: "paragraph" }],
          }));
          return commands.insertContent({ type: this.name, content: columns });
        },
    };
  },
});
