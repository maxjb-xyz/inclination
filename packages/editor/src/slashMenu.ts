import type { Editor } from "@tiptap/core";

/**
 * A slash-menu entry. `command` performs the insertion against a Tiptap editor;
 * the popup itself lives in the web app (this is a framework-light registry).
 */
export interface SlashMenuItem {
  id: string;
  title: string;
  /** Short description shown under the title in the menu. */
  description: string;
  /** Lower-cased terms matched against the slash query (besides the title). */
  keywords: string[];
  /** Insert the block. The caller is responsible for first clearing the `/query`. */
  command: (editor: Editor) => void;
}

/**
 * Registry covering every §7 block type. Each `command` inserts the node via the
 * editor's command chain (so it works identically from the slash menu and tests).
 */
export const slashMenuItems: SlashMenuItem[] = [
  {
    id: "paragraph",
    title: "Text",
    description: "Plain paragraph.",
    keywords: ["text", "paragraph", "plain", "p"],
    command: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    id: "heading1",
    title: "Heading 1",
    description: "Big section heading.",
    keywords: ["heading", "h1", "title", "#"],
    command: (editor) => editor.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    id: "heading2",
    title: "Heading 2",
    description: "Medium section heading.",
    keywords: ["heading", "h2", "subtitle", "##"],
    command: (editor) => editor.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    id: "heading3",
    title: "Heading 3",
    description: "Small section heading.",
    keywords: ["heading", "h3", "###"],
    command: (editor) => editor.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    id: "bulletList",
    title: "Bulleted list",
    description: "A simple bulleted list.",
    keywords: ["bullet", "unordered", "list", "ul", "-"],
    command: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: "orderedList",
    title: "Numbered list",
    description: "A numbered list.",
    keywords: ["ordered", "numbered", "list", "ol", "1."],
    command: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "toggleList",
    title: "Toggle list",
    description: "Collapsible toggle section.",
    keywords: ["toggle", "details", "collapse", "expand"],
    command: (editor) => editor.chain().focus().setDetails().run(),
  },
  {
    id: "taskList",
    title: "To-do list",
    description: "Track tasks with checkboxes.",
    keywords: ["todo", "task", "checkbox", "check", "[]"],
    command: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: "quote",
    title: "Quote",
    description: "Capture a quotation.",
    keywords: ["quote", "blockquote", "citation", ">"],
    command: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "callout",
    title: "Callout",
    description: "Make text stand out.",
    keywords: ["callout", "info", "note", "tip", "warning"],
    command: (editor) => editor.chain().focus().setCallout().run(),
  },
  {
    id: "divider",
    title: "Divider",
    description: "Visually divide blocks.",
    keywords: ["divider", "horizontal", "rule", "hr", "---"],
    command: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    id: "columns",
    title: "Columns",
    description: "Two side-by-side columns.",
    keywords: ["columns", "column", "layout", "grid"],
    command: (editor) => editor.chain().focus().setColumns(2).run(),
  },
  {
    id: "tableOfContents",
    title: "Table of contents",
    description: "Outline of this page's headings.",
    keywords: ["toc", "table of contents", "outline", "index"],
    command: (editor) => editor.chain().focus().setTableOfContents().run(),
  },
  {
    id: "codeBlock",
    title: "Code block",
    description: "Code with syntax highlighting.",
    keywords: ["code", "codeblock", "snippet", "```"],
    command: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "equation",
    title: "Equation",
    description: "LaTeX math (KaTeX).",
    keywords: ["equation", "math", "latex", "katex", "formula"],
    command: (editor) => editor.chain().focus().setEquation("").run(),
  },
  {
    id: "image",
    title: "Image",
    description: "Embed an image by URL.",
    keywords: ["image", "picture", "photo", "img"],
    command: (editor) => editor.chain().focus().setImage({ src: "" }).run(),
  },
  {
    id: "file",
    title: "File",
    description: "Attach a file by URL.",
    keywords: ["file", "attachment", "document", "pdf"],
    command: (editor) => editor.chain().focus().setFileBlock().run(),
  },
  {
    id: "video",
    title: "Video",
    description: "Embed a video by URL.",
    keywords: ["video", "movie", "youtube", "mp4"],
    command: (editor) => editor.chain().focus().setVideoBlock().run(),
  },
  {
    id: "bookmark",
    title: "Bookmark",
    description: "Visual link preview.",
    keywords: ["bookmark", "link", "preview", "url"],
    command: (editor) => editor.chain().focus().setBookmark().run(),
  },
  {
    id: "embed",
    title: "Embed",
    description: "Embed any iframe by URL.",
    keywords: ["embed", "iframe", "widget", "external"],
    command: (editor) => editor.chain().focus().setEmbed().run(),
  },
  {
    id: "table",
    title: "Table",
    description: "Simple inline table.",
    keywords: ["table", "grid", "rows", "columns"],
    command: (editor) =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: "pageLink",
    title: "Link to page",
    description: "Link to another page.",
    keywords: ["page", "link", "reference", "[["],
    command: (editor) => editor.chain().focus().insertContent("[[").run(),
  },
  {
    id: "mention",
    title: "Mention",
    description: "Mention a person or page.",
    keywords: ["mention", "person", "user", "@"],
    command: (editor) => editor.chain().focus().insertContent("@").run(),
  },
];

/**
 * Filter the registry by a slash query (case-insensitive, matching the title or
 * any keyword). An empty query returns every item.
 */
export function filterSlashMenuItems(query: string): SlashMenuItem[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [...slashMenuItems];
  return slashMenuItems.filter((item) => {
    if (item.title.toLowerCase().includes(q)) return true;
    return item.keywords.some((kw) => kw.toLowerCase().includes(q));
  });
}
