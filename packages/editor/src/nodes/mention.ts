import { mergeAttributes, Node } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";

export type MentionKind = "user" | "page";

export interface MentionOptions {
  HTMLAttributes: Record<string, unknown>;
  /**
   * Suggestion config injected by the host app (the `@` autocomplete UI + the
   * mentionable search). Left undefined in the package itself so it carries no
   * app/network deps. When provided, an `@` trigger opens the popup.
   */
  suggestion: Omit<SuggestionOptions, "editor"> | null;
}

export const MentionPluginKey = new PluginKey("inclinationMention");

/**
 * Inline `@`-mention node carrying `{ kind: 'user' | 'page', id, label }`.
 * Serializes to `<span data-type="mention" data-kind data-id>label</span>` so it
 * round-trips through Yjs. The suggestion popup (and the search behind it) is
 * supplied by the web app via `opts.mentionSuggestion` — the package only
 * defines the node + wiring.
 */
export const Mention = Node.create<MentionOptions>({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addOptions() {
    return { HTMLAttributes: {}, suggestion: null };
  },

  addAttributes() {
    return {
      kind: {
        default: "user" as MentionKind,
        parseHTML: (element) => (element.getAttribute("data-kind") as MentionKind) ?? "user",
        renderHTML: (attributes) => ({ "data-kind": attributes.kind as string }),
      },
      id: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-id") ?? "",
        renderHTML: (attributes) => ({ "data-id": attributes.id as string }),
      },
      label: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-label") ?? element.textContent ?? "",
        renderHTML: (attributes) => ({ "data-label": attributes.label as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="mention"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = (node.attrs.label as string) || (node.attrs.id as string);
    const prefix = node.attrs.kind === "page" ? "" : "@";
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { "data-type": "mention" }),
      `${prefix}${label}`,
    ];
  },

  renderText({ node }) {
    const label = (node.attrs.label as string) || (node.attrs.id as string);
    return node.attrs.kind === "page" ? label : `@${label}`;
  },

  addProseMirrorPlugins() {
    if (!this.options.suggestion) return [];
    return [
      Suggestion({
        editor: this.editor,
        char: "@",
        pluginKey: MentionPluginKey,
        ...this.options.suggestion,
      }),
    ];
  },
});
