import { describe, expect, it } from "vitest";
import { sanitizePublishedHtml } from "../src/publishing/sanitize";

/**
 * Phase 8 follow-up — server-side sanitize of `publishedHtml` (defense-in-depth).
 * The stored snapshot must be clean at rest: scripts/handlers/unsafe URLs gone,
 * benign formatting preserved.
 */
describe("sanitizePublishedHtml", () => {
  it("strips <script> tags and their content", () => {
    const out = sanitizePublishedHtml('<p>hi</p><script>alert("xss")</script>');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(");
    expect(out).toContain("<p>hi</p>");
  });

  it("strips inline event handlers", () => {
    const out = sanitizePublishedHtml('<p onclick="steal()">x</p>');
    expect(out).not.toContain("onclick");
    expect(out).toContain("x");
  });

  it("drops javascript: URLs on links", () => {
    const out = sanitizePublishedHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain("javascript:");
  });

  it("drops the style attribute (CSS-based vectors)", () => {
    const out = sanitizePublishedHtml('<p style="background:url(javascript:1)">x</p>');
    expect(out).not.toContain("style");
  });

  it("removes iframes / embeds / svg", () => {
    const out = sanitizePublishedHtml(
      '<iframe src="evil"></iframe><svg onload="x()"></svg><embed src="e">',
    );
    expect(out).not.toContain("<iframe");
    expect(out).not.toContain("<svg");
    expect(out).not.toContain("<embed");
  });

  it("preserves safe formatting and http(s) links/images", () => {
    const html =
      '<h1>Title</h1><p><strong>bold</strong> and <a href="https://example.com">link</a></p>' +
      '<img src="https://cdn.example.com/a.png" alt="a">';
    const out = sanitizePublishedHtml(html);
    expect(out).toContain("<h1>Title</h1>");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('src="https://cdn.example.com/a.png"');
  });

  it("forces surviving links to open safely (target+rel)", () => {
    const out = sanitizePublishedHtml('<a href="https://example.com">x</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });
});
