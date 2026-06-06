import { Node, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    databaseView: {
      /** Insert an inline/linked database block referencing a database id. */
      setDatabaseView: (attrs?: { databaseId?: string | null; linked?: boolean }) => ReturnType;
    };
  }
}

/**
 * The `databaseView` block: an atom node embedding a database into a page.
 *
 *  - `databaseId` — the referenced database (container page) id. Null until the
 *    "Database - inline" action creates one and fills it in.
 *  - `linked` — when true this is a *linked* view of a database owned by another
 *    page (the source database is not deleted with this block); when false it is
 *    an inline database whose container page is this block's owner.
 *
 * Framework-light (plain renderHTML) so it round-trips through Yjs even before a
 * React NodeView is attached; the web app attaches {@link DatabaseNodeView}.
 */
export const DatabaseViewNode = Node.create({
  name: "databaseView",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      databaseId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-database-id"),
        renderHTML: (attrs) =>
          attrs.databaseId ? { "data-database-id": attrs.databaseId as string } : {},
      },
      linked: {
        default: false,
        parseHTML: (el) => el.getAttribute("data-linked") === "true",
        renderHTML: (attrs) => (attrs.linked ? { "data-linked": "true" } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-database-view]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-database-view": "" })];
  },

  addCommands() {
    return {
      setDatabaseView:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { databaseId: attrs.databaseId ?? null, linked: attrs.linked ?? false },
          }),
    };
  },
});
