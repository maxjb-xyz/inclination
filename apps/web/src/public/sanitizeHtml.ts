/**
 * A small, dependency-free HTML sanitizer for rendering the published-page HTML
 * snapshot served by `GET /api/public/:slug`.
 *
 * The publish HTML originates from our own Tiptap editor, but the public route
 * renders it for logged-out viewers with NO auth, so we treat it defensively:
 * an attacker who managed to seed malicious markup into a published doc must not
 * get script execution in a visitor's browser. We therefore:
 *
 *   - drop disallowed elements entirely (`<script>`, `<iframe>`, `<object>`,
 *     `<embed>`, `<style>`, `<link>`, `<meta>`, etc.);
 *   - strip every `on*` event-handler attribute;
 *   - strip `javascript:` / `vbscript:` / non-image `data:` URLs from
 *     `href`/`src`/`xlink:href`.
 *
 * It parses via the platform DOMParser (jsdom in tests, the browser in prod) so
 * we never execute the markup while inspecting it — `DOMParser.parseFromString`
 * does NOT run scripts or load subresources. The returned string is safe to pass
 * to `dangerouslySetInnerHTML`.
 */

/** Tags removed wholesale (with their content) — never safe to render inert. */
const FORBIDDEN_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "LINK",
  "META",
  "BASE",
  "FORM",
  "NOSCRIPT",
  "TEMPLATE",
]);

/** URL-bearing attributes whose scheme we validate. */
const URL_ATTRS = new Set(["href", "src", "xlink:href"]);

/**
 * Matches ASCII whitespace + control chars (U+0000–U+0020) an attacker might
 * inject to obfuscate a scheme (e.g. "java\tscript:"). Built via `new RegExp`
 * with unicode escapes so the source carries no literal control bytes.
 */
const CONTROL_CHARS = new RegExp("[\\u0000-\\u0020]+", "g");

/** A scheme is allowed if it is http/https/mailto, a relative URL, or a data: image. */
function isSafeAttrUrl(value: string): boolean {
  // Strip whitespace/control chars first — browsers ignore these when resolving.
  const collapsed = value.replace(CONTROL_CHARS, "").toLowerCase();
  if (collapsed.startsWith("javascript:")) return false;
  if (collapsed.startsWith("vbscript:")) return false;
  // Allow image data URLs (Tiptap may inline small images); reject other data:.
  if (collapsed.startsWith("data:")) return collapsed.startsWith("data:image/");
  return true;
}

/** Recursively scrub a node tree in place. */
function scrub(node: Node): void {
  // Walk a snapshot of children (we mutate the live list as we go).
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      if (FORBIDDEN_TAGS.has(el.tagName)) {
        el.remove();
        continue;
      }
      // Strip every event handler + unsafe URL attribute.
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on")) {
          el.removeAttribute(attr.name);
          continue;
        }
        if (URL_ATTRS.has(name) && !isSafeAttrUrl(attr.value)) {
          el.removeAttribute(attr.name);
        }
      }
      scrub(el);
    } else if (child.nodeType === Node.COMMENT_NODE) {
      child.remove();
    }
  }
}

/**
 * Sanitize an HTML string, returning markup safe to inject. Disallowed elements
 * are removed, event-handler attributes stripped, and unsafe URL schemes dropped.
 */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  scrub(doc.body);
  return doc.body.innerHTML;
}
