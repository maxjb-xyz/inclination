import { Node, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    syncedBlock: {
      /** Insert a synced block referencing a synced-block id (its own Yjs doc). */
      setSyncedBlock: (attrs?: { syncedBlockId?: string | null }) => ReturnType;
    };
  }
}

/**
 * The `syncedBlock` block: an atom node embedding a SyncedBlock's OWN Yjs
 * document (keyed `synced:{id}`) into a page. The same `syncedBlockId` embedded
 * on two pages binds to the SAME Yjs doc, so edits propagate between them.
 *
 *  - `syncedBlockId` — the referenced SyncedBlock id. Null until the "Synced
 *    block" slash action creates one (`POST /workspaces/:wsId/synced-blocks`)
 *    and fills it in.
 *
 * Framework-light (plain renderHTML) so the host page's outer doc round-trips
 * through Yjs even before a React NodeView is attached; the web app attaches the
 * nested-collab NodeView.
 */
export const SyncedBlockNode = Node.create({
  name: "syncedBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      syncedBlockId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-synced-block-id"),
        renderHTML: (attrs) =>
          attrs.syncedBlockId
            ? { "data-synced-block-id": attrs.syncedBlockId as string }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-synced-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-synced-block": "" })];
  },

  addCommands() {
    return {
      setSyncedBlock:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { syncedBlockId: attrs.syncedBlockId ?? null },
          }),
    };
  },
});
