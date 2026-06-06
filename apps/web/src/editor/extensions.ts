import type { AnyExtension, BuildBlockExtensionsOptions } from "@inclination/editor";
import { buildBlockExtensions } from "@inclination/editor";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { EquationView } from "./EquationView";
import { MediaView } from "./MediaView";
import { SlashMenu } from "./slashSuggestion";

/** Node names that get a rich React NodeView in the web app. */
const MEDIA_NODES = new Set(["fileBlock", "videoBlock", "bookmark", "embed"]);

/**
 * Build the editor's extension set for the web: the shared §7 block set from
 * `@inclination/editor`, with React NodeViews attached for the few nodes that
 * need rich UI (equation → KaTeX render/edit; media → URL embed/preview), plus
 * the slash-menu suggestion extension.
 *
 * The base nodes are framework-light (plain `renderHTML`), so they still
 * round-trip through Yjs even before a NodeView is attached.
 */
export function buildWebExtensions(opts: BuildBlockExtensionsOptions = {}): AnyExtension[] {
  const base = buildBlockExtensions(opts);

  const withNodeViews = base.map((ext) => {
    if (ext.name === "equation") {
      return ext.extend({ addNodeView: () => ReactNodeViewRenderer(EquationView) });
    }
    if (MEDIA_NODES.has(ext.name)) {
      return ext.extend({ addNodeView: () => ReactNodeViewRenderer(MediaView) });
    }
    return ext;
  });

  return [...withNodeViews, SlashMenu];
}
