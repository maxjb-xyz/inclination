import { mergeAttributes, Node } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";

export interface PageLinkOptions {
  HTMLAttributes: Record<string, unknown>;
  /**
   * Suggestion config injected by the host app (the `[[` page-search popup).
   * Undefined in the package so it stays free of app/network deps.
   */
  suggestion: Omit<SuggestionOptions, "editor"> | null;
}

export const PageLinkPluginKey = new PluginKey("inclinationPageLink");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageLink: {
      /** Insert a page-link inline node. */
      setPageLink: (attrs: { pageId: string; label?: string }) => ReturnType;
    };
  }
}

/**
 * Inline page-link node carrying `{ pageId, label }`. Serializes to
 * `<a data-type="page-link" data-page-id>label</a>` so it round-trips through
 * Yjs and feeds the backlink extractor ({@link extractPageReferences}). The
 * `[[` suggestion UI + page search is injected by the web app via
 * `opts.pageLinkSuggestion`.
 */
export const PageLink = Node.create<PageLinkOptions>({
  name: "pageLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addOptions() {
    return { HTMLAttributes: {}, suggestion: null };
  },

  addAttributes() {
    return {
      pageId: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-page-id") ?? "",
        renderHTML: (attributes) => ({ "data-page-id": attributes.pageId as string }),
      },
      label: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-label") ?? element.textContent ?? "",
        renderHTML: (attributes) => ({ "data-label": attributes.label as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-type="page-link"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = (node.attrs.label as string) || "Untitled";
    return [
      "a",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { "data-type": "page-link" }),
      label,
    ];
  },

  renderText({ node }) {
    return (node.attrs.label as string) || "Untitled";
  },

  addCommands() {
    return {
      setPageLink:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addProseMirrorPlugins() {
    if (!this.options.suggestion) return [];
    return [
      Suggestion({
        editor: this.editor,
        char: "[[",
        pluginKey: PageLinkPluginKey,
        ...this.options.suggestion,
      }),
    ];
  },
});
