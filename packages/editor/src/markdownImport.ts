/**
 * Pure Markdown → ProseMirror-JSON parsing for the Phase-4 block set (spec §7,
 * §8). Uses `markdown-it`'s token stream (no DOM) and maps tokens to the editor
 * schema. Server-side import seeds `PageContent.doc` (PM-JSON) from this output.
 *
 * Also provides `splitMarkdownIntoTree`: when a document has multiple top-level
 * `#` (H1) sections, each H1 becomes a child page (the splitting rule), so an
 * import lands as a page tree rather than one giant page.
 */

import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import type { ProseMirrorNodeJSON } from "./references.js";

const md = new MarkdownIt({ html: false, linkify: true });

interface PMNode {
  type?: string;
  attrs?: Record<string, unknown> | null;
  content?: PMNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

/** Convert an `inline` token's children into ProseMirror inline nodes. */
function inlineTokensToNodes(children: Token[] | null): PMNode[] {
  if (!children) return [];
  const nodes: PMNode[] = [];
  const markStack: { type: string; attrs?: Record<string, unknown> }[] = [];

  const pushText = (text: string): void => {
    if (!text) return;
    const marks = markStack.map((m) => ({ type: m.type, ...(m.attrs ? { attrs: m.attrs } : {}) }));
    nodes.push(marks.length ? { type: "text", text, marks } : { type: "text", text });
  };

  for (const tok of children) {
    switch (tok.type) {
      case "text":
        pushText(tok.content);
        break;
      case "softbreak":
        pushText(" ");
        break;
      case "hardbreak":
        nodes.push({ type: "hardBreak" });
        break;
      case "code_inline": {
        nodes.push({ type: "text", text: tok.content, marks: [{ type: "code" }] });
        break;
      }
      case "strong_open":
        markStack.push({ type: "bold" });
        break;
      case "strong_close":
        removeMark(markStack, "bold");
        break;
      case "em_open":
        markStack.push({ type: "italic" });
        break;
      case "em_close":
        removeMark(markStack, "italic");
        break;
      case "s_open":
        markStack.push({ type: "strike" });
        break;
      case "s_close":
        removeMark(markStack, "strike");
        break;
      case "link_open": {
        const href = tok.attrGet("href") ?? "";
        markStack.push({ type: "link", attrs: { href } });
        break;
      }
      case "link_close":
        removeMark(markStack, "link");
        break;
      case "image": {
        const src = tok.attrGet("src") ?? "";
        const alt = tok.content ?? tok.attrGet("alt") ?? "";
        // Images are block nodes in our schema; surface them inline as a link-ish
        // text fallback is avoided — emit a standalone image node sibling later.
        nodes.push({ type: "image", attrs: { src, alt } });
        break;
      }
      default:
        if (tok.content) pushText(tok.content);
        break;
    }
  }
  return nodes;
}

function removeMark(stack: { type: string }[], type: string): void {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (stack[i]!.type === type) {
      stack.splice(i, 1);
      return;
    }
  }
}

/**
 * Walk markdown-it's flat token stream into a ProseMirror block array. Lists are
 * handled recursively by tracking open/close pairs.
 */
function tokensToBlocks(tokens: Token[]): PMNode[] {
  const blocks: PMNode[] = [];
  let i = 0;

  while (i < tokens.length) {
    const tok = tokens[i]!;
    switch (tok.type) {
      case "heading_open": {
        const level = Math.min(Number(tok.tag.slice(1)) || 1, 6);
        const inline = tokens[i + 1];
        const content = inline?.type === "inline" ? inlineTokensToNodes(inline.children) : [];
        blocks.push(...extractImages({ type: "heading", attrs: { level }, content }));
        i += 3;
        break;
      }
      case "paragraph_open": {
        const inline = tokens[i + 1];
        const content = inline?.type === "inline" ? inlineTokensToNodes(inline.children) : [];
        blocks.push(...extractImages({ type: "paragraph", content }));
        i += 3;
        break;
      }
      case "blockquote_open": {
        const { tokens: inner, next } = sliceBlock(tokens, i, "blockquote_open", "blockquote_close");
        blocks.push({ type: "blockquote", content: tokensToBlocks(inner) });
        i = next;
        break;
      }
      case "bullet_list_open": {
        const { tokens: inner, next } = sliceBlock(tokens, i, "bullet_list_open", "bullet_list_close");
        blocks.push(parseList(inner, false));
        i = next;
        break;
      }
      case "ordered_list_open": {
        const { tokens: inner, next } = sliceBlock(tokens, i, "ordered_list_open", "ordered_list_close");
        blocks.push(parseList(inner, true));
        i = next;
        break;
      }
      case "fence":
      case "code_block": {
        const language = tok.info ? tok.info.trim().split(/\s+/)[0]! : "";
        const text = tok.content.replace(/\n$/, "");
        blocks.push({
          type: "codeBlock",
          ...(language ? { attrs: { language } } : {}),
          content: text ? [{ type: "text", text }] : [],
        });
        i += 1;
        break;
      }
      case "hr":
        blocks.push({ type: "horizontalRule" });
        i += 1;
        break;
      case "table_open": {
        const { tokens: inner, next } = sliceBlock(tokens, i, "table_open", "table_close");
        const table = parseTable(inner);
        if (table) blocks.push(table);
        i = next;
        break;
      }
      default:
        i += 1;
        break;
    }
  }
  return blocks;
}

/**
 * A list item may contain a task-list checkbox (`[ ]`/`[x]`). We detect the GFM
 * convention from the leading inline text and produce a taskList/taskItem.
 */
function parseList(tokens: Token[], ordered: boolean): PMNode {
  const items: PMNode[] = [];
  let i = 0;
  let isTaskList = false;
  while (i < tokens.length) {
    if (tokens[i]!.type === "list_item_open") {
      const { tokens: inner, next } = sliceBlock(tokens, i, "list_item_open", "list_item_close");
      const itemBlocks = tokensToBlocks(inner);
      // Task detection on the first paragraph's leading text.
      let checked: boolean | null = null;
      const first = itemBlocks[0];
      if (first && (first.type === "paragraph" || first.type === "heading")) {
        const textNode = (first.content ?? [])[0] as PMNode | undefined;
        if (textNode?.type === "text" && typeof textNode.text === "string") {
          const m = textNode.text.match(/^\[([ xX])\]\s+/);
          if (m) {
            checked = m[1]!.toLowerCase() === "x";
            textNode.text = textNode.text.slice(m[0].length);
          }
        }
      }
      if (checked !== null) {
        isTaskList = true;
        items.push({ type: "taskItem", attrs: { checked }, content: itemBlocks });
      } else {
        items.push({ type: "listItem", content: itemBlocks });
      }
      i = next;
    } else {
      i += 1;
    }
  }
  if (isTaskList) {
    return { type: "taskList", content: items.map((it) => (it.type === "listItem" ? { ...it, type: "taskItem", attrs: { checked: false } } : it)) };
  }
  return { type: ordered ? "orderedList" : "bulletList", content: items };
}

function parseTable(tokens: Token[]): PMNode | null {
  const rows: PMNode[] = [];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i]!;
    if (tok.type === "tr_open") {
      const { tokens: inner, next } = sliceBlock(tokens, i, "tr_open", "tr_close");
      const cells: PMNode[] = [];
      let j = 0;
      while (j < inner.length) {
        const c = inner[j]!;
        if (c.type === "th_open" || c.type === "td_open") {
          const closeType = c.type === "th_open" ? "th_close" : "td_close";
          const { tokens: cellInner, next: cn } = sliceBlock(inner, j, c.type, closeType);
          const inlineTok = cellInner.find((t) => t.type === "inline");
          const content = inlineTok ? inlineTokensToNodes(inlineTok.children) : [];
          cells.push({
            type: c.type === "th_open" ? "tableHeader" : "tableCell",
            content: [{ type: "paragraph", content }],
          });
          j = cn;
        } else {
          j += 1;
        }
      }
      if (cells.length) rows.push({ type: "tableRow", content: cells });
      i = next;
    } else {
      i += 1;
    }
  }
  return rows.length ? { type: "table", content: rows } : null;
}

/**
 * Extract block-level `image` nodes out of an inline content array. ProseMirror
 * images are block nodes, so an image found inside a paragraph is hoisted to a
 * sibling block; remaining inline content stays in the original block.
 */
function extractImages(block: PMNode): PMNode[] {
  const content = (block.content ?? []) as PMNode[];
  const imageNodes = content.filter((n) => n.type === "image");
  if (imageNodes.length === 0) return [block];
  const rest = content.filter((n) => n.type !== "image");
  const out: PMNode[] = [];
  if (rest.length) out.push({ ...block, content: rest });
  for (const img of imageNodes) out.push({ type: "image", attrs: img.attrs ?? {} });
  return out.length ? out : imageNodes;
}

/** Slice the inner token range between a matching open/close pair (balanced). */
function sliceBlock(
  tokens: Token[],
  startIdx: number,
  openType: string,
  closeType: string,
): { tokens: Token[]; next: number } {
  let depth = 0;
  let i = startIdx;
  for (; i < tokens.length; i += 1) {
    if (tokens[i]!.type === openType) depth += 1;
    else if (tokens[i]!.type === closeType) {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return { tokens: tokens.slice(startIdx + 1, i), next: i + 1 };
}

/** A ProseMirror `doc` node wrapping the given blocks (paragraph fallback). */
function wrapDoc(blocks: PMNode[]): PMNode {
  return { type: "doc", content: blocks.length ? blocks : [{ type: "paragraph" }] };
}

/**
 * Parse a Markdown string into a single ProseMirror `doc` JSON for the block set.
 */
export function markdownToProseMirror(markdown: string): ProseMirrorNodeJSON {
  const tokens = md.parse(markdown ?? "", {});
  return wrapDoc(tokensToBlocks(tokens));
}

// ── Tree splitting ──────────────────────────────────────────────────

export interface ImportedPageNode {
  /** Page title (from the section's H1, the first heading, or the filename). */
  title: string;
  /** The page body as ProseMirror `doc` JSON. */
  doc: ProseMirrorNodeJSON;
  /** Child pages, one per nested top-level section. */
  children: ImportedPageNode[];
}

/**
 * Derive a human title from a filename: strip the directory + `.md`/`.markdown`
 * extension and turn separators into spaces.
 */
export function titleFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return base.replace(/\.(md|markdown|mdown|txt)$/i, "").replace(/[-_]+/g, " ").trim() || "Untitled";
}

/** First-line text of a heading/paragraph block, for deriving a title. */
function blockText(block: PMNode): string {
  return ((block.content ?? []) as PMNode[])
    .map((n) => (typeof n.text === "string" ? n.text : ""))
    .join("")
    .trim();
}

/**
 * Parse Markdown into an imported page tree (spec §8 gate: "imports into a page
 * tree").
 *
 * Splitting rule:
 *   - Parse the whole document into blocks.
 *   - Count top-level H1 (`#`) headings. If there are 2 OR MORE, EACH H1 starts
 *     a new CHILD page: its title is the H1 text and its body is every block
 *     until the next H1 (the H1 heading itself is consumed into the title). Any
 *     content BEFORE the first H1 stays on the top (parent) page.
 *   - If there are fewer than 2 H1s, the whole document is one page (no split).
 *   - The top page's title comes from a single leading H1 (when not split) else
 *     the filename.
 */
export function splitMarkdownIntoTree(filename: string, markdown: string): ImportedPageNode {
  const tokens = md.parse(markdown ?? "", {});
  const blocks = tokensToBlocks(tokens);

  const h1Indices = blocks
    .map((b, idx) => (b.type === "heading" && b.attrs?.level === 1 ? idx : -1))
    .filter((idx) => idx >= 0);

  // Fewer than two H1s → single page.
  if (h1Indices.length < 2) {
    let title = titleFromFilename(filename);
    let body = blocks;
    // A single leading H1 becomes the page title and is dropped from the body.
    if (h1Indices.length === 1 && h1Indices[0] === 0) {
      title = blockText(blocks[0]!) || title;
      body = blocks.slice(1);
    } else if (blocks[0]?.type === "heading") {
      title = blockText(blocks[0]!) || title;
    }
    return { title, doc: wrapDoc(body), children: [] };
  }

  // Two+ H1s → split each H1 section into a child page.
  const preamble = blocks.slice(0, h1Indices[0]!);
  const children: ImportedPageNode[] = [];
  for (let k = 0; k < h1Indices.length; k += 1) {
    const start = h1Indices[k]!;
    const end = k + 1 < h1Indices.length ? h1Indices[k + 1]! : blocks.length;
    const heading = blocks[start]!;
    const sectionBody = blocks.slice(start + 1, end);
    children.push({
      title: blockText(heading) || `Section ${k + 1}`,
      doc: wrapDoc(sectionBody),
      children: [],
    });
  }

  return {
    title: titleFromFilename(filename),
    doc: wrapDoc(preamble),
    children,
  };
}
