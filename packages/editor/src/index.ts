/**
 * @inclination/editor — the shared Tiptap extension package for the full §7
 * block set. Framework-light: it defines the schema, custom nodes, Markdown
 * input rules, a slash-menu registry, and a backlink-extraction util. The web
 * app supplies React NodeViews and the suggestion popups for `@`/`[[`.
 */
export const EDITOR_PACKAGE_VERSION = "0.0.0";

export { buildBlockExtensions } from "./extensions.js";
export type { AnyExtension, BuildBlockExtensionsOptions } from "./extensions.js";

export { slashMenuItems, filterSlashMenuItems } from "./slashMenu.js";
export type { SlashMenuItem } from "./slashMenu.js";

export { extractPageReferences } from "./references.js";
export type { ProseMirrorNodeJSON } from "./references.js";

// Markdown export (PM-JSON → Markdown) and import (Markdown → PM-JSON + tree).
export { proseMirrorToMarkdown } from "./markdown.js";
export {
  markdownToProseMirror,
  splitMarkdownIntoTree,
  titleFromFilename,
} from "./markdownImport.js";
export type { ImportedPageNode } from "./markdownImport.js";

// URL guard for user-supplied media URLs (http/https only) — prevents stored XSS.
export { isSafeUrl, safeUrl } from "./url.js";

// Custom nodes (exported so the web can attach React NodeViews).
export { Callout } from "./nodes/callout.js";
export { Columns, Column } from "./nodes/columns.js";
export { TableOfContents } from "./nodes/tableOfContents.js";
export { Equation, renderEquation } from "./nodes/equation.js";
export { FileBlock, VideoBlock, Bookmark, Embed } from "./nodes/media.js";
export { Mention, MentionPluginKey } from "./nodes/mention.js";
export type { MentionKind, MentionOptions } from "./nodes/mention.js";
export { PageLink, PageLinkPluginKey } from "./nodes/pageLink.js";
export type { PageLinkOptions } from "./nodes/pageLink.js";
