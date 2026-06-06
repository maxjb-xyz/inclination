/**
 * @inclination/editor — the shared Tiptap extension package for the full §7
 * block set. Framework-light: it defines the schema, custom nodes, Markdown
 * input rules, a slash-menu registry, and a backlink-extraction util. The web
 * app supplies React NodeViews and the suggestion popups for `@`/`[[`.
 */
export const EDITOR_PACKAGE_VERSION = "0.0.0";

export { buildBlockExtensions } from "./extensions";
export type { AnyExtension, BuildBlockExtensionsOptions } from "./extensions";

export { slashMenuItems, filterSlashMenuItems } from "./slashMenu";
export type { SlashMenuItem } from "./slashMenu";

export { extractPageReferences } from "./references";
export type { ProseMirrorNodeJSON } from "./references";

// URL guard for user-supplied media URLs (http/https only) — prevents stored XSS.
export { isSafeUrl, safeUrl } from "./url";

// Custom nodes (exported so the web can attach React NodeViews).
export { Callout } from "./nodes/callout";
export { Columns, Column } from "./nodes/columns";
export { TableOfContents } from "./nodes/tableOfContents";
export { Equation, renderEquation } from "./nodes/equation";
export { FileBlock, VideoBlock, Bookmark, Embed } from "./nodes/media";
export { Mention, MentionPluginKey } from "./nodes/mention";
export type { MentionKind, MentionOptions } from "./nodes/mention";
export { PageLink, PageLinkPluginKey } from "./nodes/pageLink";
export type { PageLinkOptions } from "./nodes/pageLink";
