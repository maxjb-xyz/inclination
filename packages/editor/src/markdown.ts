/**
 * Pure ProseMirror-JSON ↔ Markdown conversion for the Phase-4 block set (spec
 * §7). Framework-light: no Tiptap/ProseMirror runtime, no DOM — just plain
 * structural walks over the document JSON, so it runs server-side (API export /
 * import endpoints) and is trivially unit-testable.
 *
 * Coverage (round-trips at the block level; see notes for lossy cases):
 *   - paragraph, heading (H1–H3)
 *   - bulletList / orderedList (with nesting), taskList (to-do)
 *   - blockquote, callout (→ blockquote), horizontalRule (divider)
 *   - codeBlock (fenced, with language)
 *   - table (inline) → GFM pipe table
 *   - inline marks: bold, italic, code, strike, link
 *   - image (URL), mention / pageLink → text (their label)
 *
 * Fidelity decision: the doc is Yjs-authoritative, but export works from the
 * decoded PM-JSON snapshot the editor produces. Anything outside the set above
 * (columns, embeds, equations, etc.) degrades to its plain text content so
 * export never throws and always yields readable Markdown.
 */

import type { ProseMirrorNodeJSON } from "./references.js";

// ── PM-JSON → Markdown ──────────────────────────────────────────────

interface PMMark {
  type?: string;
  attrs?: Record<string, unknown> | null;
}

interface PMNode extends ProseMirrorNodeJSON {
  text?: string;
  marks?: PMMark[];
}

/** Escape the small set of Markdown-significant characters in plain text. */
function escapeText(text: string): string {
  return text.replace(/([\\`*_{}\[\]()#+\-!])/g, "\\$1");
}

/** Render a single text node with its inline marks applied (innermost first). */
function renderText(node: PMNode): string {
  let out = node.text ?? "";
  const marks = node.marks ?? [];

  // `code` wins as the innermost wrap and does not combine with emphasis.
  const hasCode = marks.some((m) => m.type === "code");
  if (hasCode) {
    return `\`${node.text ?? ""}\``;
  }

  out = escapeText(out);
  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        out = `**${out}**`;
        break;
      case "italic":
        out = `*${out}*`;
        break;
      case "strike":
        out = `~~${out}~~`;
        break;
      case "link": {
        const href = typeof mark.attrs?.href === "string" ? mark.attrs.href : "";
        if (href) out = `[${out}](${href})`;
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** Render inline content (text + inline atoms) of a block into a single line. */
function renderInline(content: PMNode[] | undefined): string {
  if (!content) return "";
  let out = "";
  for (const child of content) {
    switch (child.type) {
      case "text":
        out += renderText(child);
        break;
      case "hardBreak":
        out += "  \n";
        break;
      case "image": {
        const src = typeof child.attrs?.src === "string" ? child.attrs.src : "";
        const alt = typeof child.attrs?.alt === "string" ? child.attrs.alt : "";
        if (src) out += `![${alt}](${src})`;
        break;
      }
      case "mention": {
        const label =
          typeof child.attrs?.label === "string" && child.attrs.label
            ? child.attrs.label
            : String(child.attrs?.id ?? "");
        out += child.attrs?.kind === "page" ? label : `@${label}`;
        break;
      }
      case "pageLink": {
        const label =
          typeof child.attrs?.label === "string" && child.attrs.label
            ? child.attrs.label
            : String(child.attrs?.pageId ?? "");
        out += label;
        break;
      }
      default:
        // Unknown inline atom: fall back to any nested text.
        if (Array.isArray(child.content)) out += renderInline(child.content as PMNode[]);
        else if (typeof child.text === "string") out += escapeText(child.text);
        break;
    }
  }
  return out;
}

/** Render a list (bullet/ordered/task) with nesting via indentation. */
function renderList(node: PMNode, ordered: boolean, depth: number): string {
  const items = (node.content ?? []) as PMNode[];
  const indent = "  ".repeat(depth);
  const lines: string[] = [];
  items.forEach((item, idx) => {
    const marker = ordered ? `${idx + 1}.` : "-";
    let prefix = `${indent}${marker} `;
    if (item.type === "taskItem") {
      const checked = item.attrs?.checked === true;
      prefix = `${indent}- [${checked ? "x" : " "}] `;
    }
    const itemBlocks = (item.content ?? []) as PMNode[];
    // First paragraph forms the item line; nested lists indent under it.
    const parts: string[] = [];
    let firstLineDone = false;
    for (const block of itemBlocks) {
      if (block.type === "bulletList" || block.type === "orderedList" || block.type === "taskList") {
        parts.push(
          renderList(block, block.type === "orderedList", depth + 1),
        );
      } else {
        const text = renderInline(block.content as PMNode[]);
        if (!firstLineDone) {
          parts.unshift(`${prefix}${text}`);
          firstLineDone = true;
        } else {
          parts.push(`${indent}  ${text}`);
        }
      }
    }
    if (!firstLineDone) parts.unshift(prefix.trimEnd());
    lines.push(parts.join("\n"));
  });
  return lines.join("\n");
}

/** Render a GFM pipe table from an inline `table` node. */
function renderTable(node: PMNode): string {
  const rows = (node.content ?? []) as PMNode[];
  if (rows.length === 0) return "";
  const cellText = (cell: PMNode): string =>
    ((cell.content ?? []) as PMNode[])
      .map((b) => renderInline(b.content as PMNode[]))
      .join(" ")
      .replace(/\|/g, "\\|")
      .trim();

  const matrix = rows.map((row) => ((row.content ?? []) as PMNode[]).map(cellText));
  const colCount = Math.max(...matrix.map((r) => r.length));
  const pad = (r: string[]): string[] => {
    const copy = [...r];
    while (copy.length < colCount) copy.push("");
    return copy;
  };

  const header = pad(matrix[0] ?? []);
  const lines = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
  for (let i = 1; i < matrix.length; i += 1) {
    lines.push(`| ${pad(matrix[i] ?? []).join(" | ")} |`);
  }
  return lines.join("\n");
}

/** Render a block-level node to a Markdown string (no trailing blank line). */
function renderBlock(node: PMNode): string {
  switch (node.type) {
    case "paragraph":
      return renderInline(node.content as PMNode[]);
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
      return `${"#".repeat(level)} ${renderInline(node.content as PMNode[])}`;
    }
    case "bulletList":
      return renderList(node, false, 0);
    case "orderedList":
      return renderList(node, true, 0);
    case "taskList":
      return renderList(node, false, 0);
    case "blockquote":
    case "callout": {
      const inner = (node.content ?? []) as PMNode[];
      const text = inner.map(renderBlock).join("\n\n");
      return text
        .split("\n")
        .map((l) => (l.length ? `> ${l}` : ">"))
        .join("\n");
    }
    case "horizontalRule":
      return "---";
    case "codeBlock": {
      const lang =
        typeof node.attrs?.language === "string" ? node.attrs.language : "";
      const code = ((node.content ?? []) as PMNode[]).map((c) => c.text ?? "").join("");
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }
    case "table":
      return renderTable(node);
    case "image": {
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
      return src ? `![${alt}](${src})` : "";
    }
    default: {
      // Unknown block (columns, embed, equation, …): degrade to nested content.
      if (Array.isArray(node.content)) {
        const children = node.content as PMNode[];
        // If children are inline (text), render as a paragraph; else recurse.
        const inlineish = children.every(
          (c) => c.type === "text" || c.type === "mention" || c.type === "pageLink",
        );
        return inlineish
          ? renderInline(children)
          : children.map(renderBlock).filter((s) => s.length > 0).join("\n\n");
      }
      return "";
    }
  }
}

/**
 * Serialize a ProseMirror `doc` node to a Markdown string. Top-level blocks are
 * separated by a blank line. A null/empty doc yields "".
 */
export function proseMirrorToMarkdown(doc: ProseMirrorNodeJSON | null | undefined): string {
  if (!doc || typeof doc !== "object") return "";
  const blocks = (doc.content ?? []) as PMNode[];
  return blocks
    .map(renderBlock)
    .filter((s) => s.length > 0 || s === "")
    .map((s) => s)
    .filter((s, i, arr) => !(s === "" && arr[i - 1] === ""))
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
