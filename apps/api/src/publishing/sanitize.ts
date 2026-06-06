/**
 * Server-side HTML sanitizer for `publishedHtml` (Phase 8 follow-up,
 * defense-in-depth).
 *
 * The web client already sanitizes the published snapshot with DOMPurify before
 * rendering it for logged-out viewers, but we ALSO sanitize on the server at
 * publish time so the stored HTML is clean at rest — a stored XSS payload can
 * never reach any consumer (e.g. a future server-rendered public page, an
 * exporter, or a client whose sanitizer is bypassed). We use `sanitize-html`, a
 * widely-used server-safe sanitizer (htmlparser2-based, no DOM needed).
 *
 * The allow-list mirrors the client's (apps/web/src/public/sanitizeHtml.ts): a
 * small set of read-only formatting tags + safe attributes, http/https/mailto
 * URLs only, and `style`/event-handler/SVG/MathML/script/iframe stripped.
 */
import sanitizeHtmlLib from "sanitize-html";

const ALLOWED_TAGS = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "a",
  "strong",
  "em",
  "b",
  "i",
  "s",
  "u",
  "img",
  "br",
  "hr",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "span",
  "div",
];

const SANITIZE_OPTIONS: sanitizeHtmlLib.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan"],
    // `class` is allowed on any tag (the editor emits styling classes); `style`
    // is intentionally NOT allowed (CSS-based vectors).
    "*": ["class"],
  },
  // http/https for links + images, mailto for links. Everything else
  // (javascript:, data:, vbscript:, ...) is dropped.
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: {
    img: ["http", "https"],
    a: ["http", "https", "mailto"],
  },
  // Drop the CONTENT of script/style (not just the tag) so no inline JS/CSS
  // leaks through as text.
  nonTextTags: ["script", "style", "textarea", "noscript"],
  // Force surviving links to open safely, mirroring the client hook.
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" },
    }),
  },
  disallowedTagsMode: "discard",
};

/** Sanitize a publish HTML snapshot for safe storage + serving. */
export function sanitizePublishedHtml(html: string): string {
  return sanitizeHtmlLib(html, SANITIZE_OPTIONS);
}
