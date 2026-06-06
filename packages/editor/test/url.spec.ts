import { describe, expect, it } from "vitest";
import { isSafeUrl, safeUrl } from "../src/url";

describe("isSafeUrl", () => {
  it("accepts absolute http/https URLs", () => {
    expect(isSafeUrl("http://example.com")).toBe(true);
    expect(isSafeUrl("https://example.com/path?q=1#frag")).toBe(true);
    expect(isSafeUrl("HTTPS://EXAMPLE.COM")).toBe(true);
    expect(isSafeUrl("  https://example.com  ")).toBe(true);
  });

  it("rejects javascript: URLs (any case)", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("JavaScript:alert(1)")).toBe(false);
    expect(isSafeUrl("JAVASCRIPT:alert(document.cookie)")).toBe(false);
  });

  it("rejects whitespace/control-char obfuscated javascript: URLs", () => {
    expect(isSafeUrl("java\tscript:alert(1)")).toBe(false);
    expect(isSafeUrl("java\nscript:alert(1)")).toBe(false);
    expect(isSafeUrl("  javascript:alert(1)")).toBe(false);
  });

  it("rejects data:, vbscript:, file:, blob: schemes", () => {
    expect(isSafeUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    expect(isSafeUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeUrl("blob:https://example.com/uuid")).toBe(false);
  });

  it("rejects relative, empty, and garbage values", () => {
    expect(isSafeUrl("")).toBe(false);
    expect(isSafeUrl("   ")).toBe(false);
    expect(isSafeUrl("/relative/path")).toBe(false);
    expect(isSafeUrl("example.com")).toBe(false);
    expect(isSafeUrl("not a url")).toBe(false);
    expect(isSafeUrl(null)).toBe(false);
    expect(isSafeUrl(undefined)).toBe(false);
    expect(isSafeUrl(123)).toBe(false);
  });
});

describe("safeUrl", () => {
  it("returns the trimmed URL for safe values", () => {
    expect(safeUrl("https://example.com")).toBe("https://example.com");
    expect(safeUrl("  https://example.com  ")).toBe("https://example.com");
  });

  it("returns undefined for unsafe values", () => {
    expect(safeUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeUrl("data:text/html,x")).toBeUndefined();
    expect(safeUrl("")).toBeUndefined();
    expect(safeUrl("/relative")).toBeUndefined();
    expect(safeUrl(null)).toBeUndefined();
  });
});
