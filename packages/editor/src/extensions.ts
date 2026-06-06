import type { Extension, Node as TiptapNode, Mark } from "@tiptap/core";
import type { SuggestionOptions } from "@tiptap/suggestion";
import StarterKit from "@tiptap/starter-kit";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Details from "@tiptap/extension-details";
import DetailsContent from "@tiptap/extension-details-content";
import DetailsSummary from "@tiptap/extension-details-summary";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { createLowlight, common } from "lowlight";

import { Callout } from "./nodes/callout.js";
import { Column, Columns } from "./nodes/columns.js";
import { Equation } from "./nodes/equation.js";
import { Bookmark, Embed, FileBlock, VideoBlock } from "./nodes/media.js";
import { Mention } from "./nodes/mention.js";
import { PageLink } from "./nodes/pageLink.js";
import { TableOfContents } from "./nodes/tableOfContents.js";

/** A Tiptap extension of any kind (node, mark, or plain extension). */
export type AnyExtension = Extension | TiptapNode | Mark;

export interface BuildBlockExtensionsOptions {
  /**
   * When `true` (the default), StarterKit's local history is disabled because
   * the host binds the Yjs `Collaboration` extension, which supplies Yjs-aware
   * undo/redo. Set `false` only for a standalone (non-collaborative) editor.
   */
  collaboration?: boolean;
  /**
   * Suggestion config for the `@`-mention popup, injected by the host app so the
   * package carries no network deps. Omit to disable the popup (the node still
   * inserts via commands and round-trips).
   */
  mentionSuggestion?: Omit<SuggestionOptions, "editor">;
  /** Suggestion config for the `[[` page-link popup. Same contract as above. */
  pageLinkSuggestion?: Omit<SuggestionOptions, "editor">;
}

/**
 * Build the full §7 block-set extension array for the collaborative editor.
 *
 * Collaboration-safe: no built-in history (Yjs owns undo/redo). Includes
 * paragraph, H1–H3, bullet/ordered/toggle lists, to-do, blockquote, callout,
 * divider, columns, table of contents, code block (lowlight syntax highlight),
 * inline code, equation (KaTeX), URL-based image/file/video/bookmark/embed,
 * inline tables, and the `pageLink` + `mention` reference nodes. Markdown input
 * rules come from the underlying extensions (`#`, `-`, `1.`, `>`, ```` ``` ````,
 * `[]` to-do, `---` divider) plus the callout/toggle rules.
 */
export function buildBlockExtensions(opts: BuildBlockExtensionsOptions = {}): AnyExtension[] {
  const { collaboration = true, mentionSuggestion, pageLinkSuggestion } = opts;

  const lowlight = createLowlight(common);

  return [
    StarterKit.configure({
      // Yjs Collaboration owns undo/redo; never run two history plugins.
      history: collaboration ? false : undefined,
      // Replaced by CodeBlockLowlight for syntax highlighting.
      codeBlock: false,
      // Restrict headings to H1–H3 per the spec block set.
      heading: { levels: [1, 2, 3] },
    }),
    CodeBlockLowlight.configure({ lowlight }),
    // Toggle list (Notion "toggle") via the Details trio.
    Details.configure({ persist: true, HTMLAttributes: { class: "toggle-list" } }),
    DetailsSummary,
    DetailsContent,
    // To-do / checkbox list.
    TaskList,
    TaskItem.configure({ nested: true }),
    // Inline tables (distinct from databases).
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    // URL-based media (upload is Phase 7).
    Image.configure({ inline: false, allowBase64: false }),
    Link.configure({ openOnClick: false, autolink: true }),
    FileBlock,
    VideoBlock,
    Bookmark,
    Embed,
    // Custom structural blocks.
    Callout,
    Columns,
    Column,
    TableOfContents,
    Equation,
    // Reference nodes — suggestion configs injected by the host (T3 wires search).
    Mention.configure({ suggestion: mentionSuggestion ?? null }),
    PageLink.configure({ suggestion: pageLinkSuggestion ?? null }),
  ];
}
