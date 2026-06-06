import { mergeAttributes, Node, wrappingInputRule } from "@tiptap/core";

export interface CalloutOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      /** Wrap the current block(s) in a callout. */
      setCallout: (attributes?: { emoji?: string }) => ReturnType;
      /** Toggle a callout around the current block(s). */
      toggleCallout: (attributes?: { emoji?: string }) => ReturnType;
    };
  }
}

/** Matches a leading `> ` only when typed inside an explicit callout context. */
const calloutInputRegex = /^!\s$/;

/**
 * Callout block — a highlighted container with a leading emoji. Holds block
 * content (so it can nest other blocks). Rendered as `<div data-type="callout">`
 * so it round-trips through the Yjs doc without needing a NodeView; the web app
 * may attach a React NodeView for a richer emoji picker.
 */
export const Callout = Node.create<CalloutOptions>({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      emoji: {
        default: "💡",
        parseHTML: (element) => element.getAttribute("data-emoji") ?? "💡",
        renderHTML: (attributes) => ({ "data-emoji": attributes.emoji as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { "data-type": "callout" }),
      0,
    ];
  },

  addCommands() {
    return {
      setCallout:
        (attributes) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attributes),
      toggleCallout:
        (attributes) =>
        ({ commands }) =>
          commands.toggleWrap(this.name, attributes),
    };
  },

  addInputRules() {
    return [wrappingInputRule({ find: calloutInputRegex, type: this.type })];
  },
});
