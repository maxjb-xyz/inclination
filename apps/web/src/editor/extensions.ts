import type { AnyExtension, BuildBlockExtensionsOptions } from "@inclination/editor";
import { buildBlockExtensions } from "@inclination/editor";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { EquationView } from "./EquationView";
import { MediaView } from "./MediaView";
import { MentionView } from "./MentionView";
import { PageLinkView } from "./PageLinkView";
import { SlashMenu } from "./slashSuggestion";
import { DatabaseViewNode } from "./databaseNode";
import { DatabaseNodeView } from "./DatabaseNodeView";

/** Node names that get a rich React NodeView in the web app. */
const MEDIA_NODES = new Set(["fileBlock", "videoBlock", "bookmark", "embed"]);

/**
 * Build the editor's extension set for the web: the shared §7 block set from
 * `@inclination/editor`, with React NodeViews attached for the few nodes that
 * need rich UI (equation → KaTeX render/edit; media → URL embed/preview;
 * mention + pageLink → live title + click-to-navigate), plus the slash-menu
 * suggestion extension.
 *
 * `opts.mentionSuggestion` / `opts.pageLinkSuggestion` (the `@` / `[[`
 * autocomplete configs) are threaded through to `buildBlockExtensions`; the web
 * supplies them via {@link buildMentionSuggestion} / {@link buildPageLinkSuggestion}.
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
    if (ext.name === "mention") {
      return ext.extend({ addNodeView: () => ReactNodeViewRenderer(MentionView) });
    }
    if (ext.name === "pageLink") {
      return ext.extend({ addNodeView: () => ReactNodeViewRenderer(PageLinkView) });
    }
    if (MEDIA_NODES.has(ext.name)) {
      return ext.extend({ addNodeView: () => ReactNodeViewRenderer(MediaView) });
    }
    return ext;
  });

  // The inline/linked database block is web-only (it embeds the live database
  // UI), so it is added here rather than in the shared package.
  const databaseNode = DatabaseViewNode.extend({
    addNodeView: () => ReactNodeViewRenderer(DatabaseNodeView),
  });

  return [...withNodeViews, databaseNode, SlashMenu];
}
