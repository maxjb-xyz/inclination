import { mergeAttributes, Node } from "@tiptap/core";
import katex from "katex";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    equation: {
      /** Insert a block equation with the given LaTeX source. */
      setEquation: (latex?: string) => ReturnType;
    };
  }
}

/**
 * Render a LaTeX string to an HTML string with KaTeX. Returns the raw source
 * (HTML-escaped) on a parse error so the editor never throws. Exported so the
 * web app's NodeView can reuse the exact same rendering.
 */
export function renderEquation(latex: string): string {
  try {
    return katex.renderToString(latex, { throwOnError: false, displayMode: true });
  } catch {
    const escaped = latex.replace(/[&<>"']/g, (c) => {
      switch (c) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        default:
          return "&#39;";
      }
    });
    return escaped;
  }
}

/**
 * Block equation node (KaTeX). Stores the LaTeX `latex` source as an attribute
 * so it round-trips through Yjs. `renderHTML` produces a stable DOM shell; the
 * web app attaches a React NodeView that renders {@link renderEquation} and
 * offers inline editing. Atom: the LaTeX is data, not editable prose.
 */
export const Equation = Node.create({
  name: "equation",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-latex") ?? "",
        renderHTML: (attributes) => ({ "data-latex": attributes.latex as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="equation"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "equation" })];
  },

  addCommands() {
    return {
      setEquation:
        (latex = "") =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex } }),
    };
  },
});
