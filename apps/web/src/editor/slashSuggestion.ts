import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { filterSlashMenuItems, type SlashMenuItem } from "@inclination/editor";
import { SlashMenuList, type SlashMenuListHandle } from "./SlashMenu";

export const SlashMenuPluginKey = new PluginKey("inclinationSlashMenu");

/**
 * Web-only slash items layered on top of the shared §7 registry. "Database -
 * inline" inserts an empty `databaseView` node; the node's NodeView then creates
 * the backing database (it has the workspace/create context the editor lacks).
 */
export const WEB_SLASH_ITEMS: SlashMenuItem[] = [
  {
    id: "databaseInline",
    title: "Database - inline",
    description: "Embed a new inline database.",
    keywords: ["database", "table", "collection", "inline", "db"],
    command: (editor) => editor.chain().focus().setDatabaseView().run(),
  },
  {
    id: "syncedBlock",
    title: "Synced block",
    description: "Reusable content that stays in sync everywhere it's embedded.",
    keywords: ["synced", "sync", "reusable", "mirror", "shared"],
    command: (editor) => editor.chain().focus().setSyncedBlock().run(),
  },
];

/** Filter the merged shared + web slash registry by a query. */
export function filterWebSlashMenuItems(query: string): SlashMenuItem[] {
  const base = filterSlashMenuItems(query);
  const q = query.trim().toLowerCase();
  const web = WEB_SLASH_ITEMS.filter(
    (item) =>
      q.length === 0 ||
      item.title.toLowerCase().includes(q) ||
      item.keywords.some((kw) => kw.includes(q)),
  );
  return [...base, ...web];
}

/**
 * Slash-menu extension. A `/` at the start of a text run opens a popup listing
 * the block-type registry from `@inclination/editor`, filtered live by the
 * query. Selecting an item deletes the `/query` and runs the item's command.
 *
 * The popup is a React tree mounted into a floating `<div>` positioned at the
 * caret; we avoid a third-party popover lib to keep deps light and tests inert.
 */
export const SlashMenu = Extension.create({
  name: "slashMenu",

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashMenuItem>({
        editor: this.editor,
        char: "/",
        pluginKey: SlashMenuPluginKey,
        // Only trigger at the start of a node or after whitespace.
        allowSpaces: false,
        startOfLine: false,
        items: ({ query }) => filterWebSlashMenuItems(query),
        command: ({ editor, range, props }) => {
          // Remove the "/query" text, then run the block command.
          editor.chain().focus().deleteRange(range).run();
          props.command(editor);
        },
        render: () => {
          let container: HTMLDivElement | null = null;
          let root: Root | null = null;
          let handleRef: SlashMenuListHandle | null = null;

          const position = (props: SuggestionProps<SlashMenuItem>): void => {
            if (!container) return;
            const rect = props.clientRect?.();
            if (!rect) return;
            container.style.left = `${rect.left + window.scrollX}px`;
            container.style.top = `${rect.bottom + window.scrollY + 4}px`;
          };

          const renderList = (props: SuggestionProps<SlashMenuItem>): void => {
            if (!root) return;
            root.render(
              createElement(SlashMenuList, {
                items: props.items,
                command: (item) => props.command(item),
                ref: (h: SlashMenuListHandle | null) => {
                  handleRef = h;
                },
              }),
            );
          };

          return {
            onStart: (props) => {
              container = document.createElement("div");
              container.className = "slash-menu-popover";
              container.style.position = "absolute";
              container.style.zIndex = "50";
              document.body.appendChild(container);
              root = createRoot(container);
              renderList(props);
              position(props);
            },
            onUpdate: (props) => {
              renderList(props);
              position(props);
            },
            onKeyDown: (props) => {
              if (props.event.key === "Escape") return true;
              return handleRef?.onKeyDown(props.event) ?? false;
            },
            onExit: () => {
              root?.unmount();
              root = null;
              container?.remove();
              container = null;
              handleRef = null;
            },
          };
        },
      }),
    ];
  },
});
