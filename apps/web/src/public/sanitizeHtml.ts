/**
 * HTML sanitizer for the published-page snapshot served by `GET /api/public/:slug`.
 *
 * The publish HTML originates from our own Tiptap editor, but the public route
 * renders it for logged-out viewers with NO auth, so we treat it defensively:
 * an attacker who managed to seed malicious markup into a published doc must not
 * get script execution in a visitor's browser.
 *
 * We delegate to DOMPurify — a widely vetted sanitizer that handles the whole
 * HTML/SVG/MathML attack surface (namespace-confusion, mutation XSS, `data:`
 * smuggling, CSS-based vectors, etc.) far more robustly than a hand-rolled
 * tag/attribute walk could. DOMPurify runs against the platform DOM (the browser
 * in prod, jsdom in tests) and never executes the markup while inspecting it. The
 * returned string is safe to pass to `dangerouslySetInnerHTML`.
 */

import DOMPurify from "dompurify";

/**
 * Formatting tags we allow for a read-only public document. Deliberately a small
 * allow-list — anything not named here (script/iframe/object/embed/style/svg/
 * math/form/...) is dropped by DOMPurify.
 */
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

/**
 * Safe attributes. Note `style` is intentionally absent: it carries
 * CSS-based vectors (e.g. `background:url(javascript:...)`) and is never needed
 * for a read-only render. Event handlers (`on*`) are stripped by DOMPurify.
 */
const ALLOWED_ATTR = ["href", "src", "alt", "title", "colspan", "rowspan", "class"];

/**
 * Permit only http/https/mailto schemes (plus protocol-relative and relative
 * URLs). `data:`, `javascript:`, `vbscript:`, etc. are rejected. Anchored and
 * case-insensitive; matches DOMPurify's structure but narrower than its default
 * (which also allows `tel:`, `ftp:`, `xmpp:`, image `data:` URLs, ...).
 */
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;

const PURIFY_CONFIG = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  ALLOWED_URI_REGEXP,
  // Belt-and-suspenders: even if an entry crept into the allow-lists, never
  // permit these. Forbidding the `style` attr also disables CSS-based vectors.
  // Because only HTML-namespace tags are allow-listed above, any SVG/MathML
  // element (whatever its case-sensitive local name) is dropped regardless.
  FORBID_TAGS: ["script", "iframe", "object", "embed", "style", "svg", "math", "form"],
  FORBID_ATTR: ["style"],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
};

let hookInstalled = false;

/**
 * Force every surviving anchor to open safely. Installed once, globally — the
 * hook fires per-element during `sanitize()`.
 */
function ensureLinkHook(): void {
  if (hookInstalled) return;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName === "A" && node instanceof Element && node.hasAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
  hookInstalled = true;
}

/**
 * Sanitize an HTML string, returning markup safe to inject. Disallowed elements
 * (incl. SVG/MathML-namespaced ones) are removed, event-handler and `style`
 * attributes stripped, and unsafe URL schemes dropped.
 */
export function sanitizeHtml(html: string): string {
  ensureLinkHook();
  return DOMPurify.sanitize(html, PURIFY_CONFIG);
}
