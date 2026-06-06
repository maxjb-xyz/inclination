import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sanitizeHtml } from "../src/public/sanitizeHtml";
import { PublicPageView } from "../src/public/PublicPageView";
import { publicSlugFromPath } from "../src/public/route";
import type { PublicPage } from "../src/api/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("sanitizeHtml", () => {
  /**
   * Render sanitized output into a *live* DOM the way PublicPageView does, then
   * assert no dangerous element/attribute survives. Inspecting the live tree
   * (not just the string) catches mutation-XSS that re-parses differently.
   */
  function liveSanitize(html: string): HTMLElement {
    const host = document.createElement("div");
    host.innerHTML = sanitizeHtml(html);
    return host;
  }

  function assertNoDangerousMarkup(host: HTMLElement): void {
    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector("svg")).toBeNull();
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector("style")).toBeNull();
    expect(host.querySelector("math")).toBeNull();
    expect(host.querySelector("object")).toBeNull();
    expect(host.querySelector("embed")).toBeNull();
    expect(host.querySelector("animate")).toBeNull();
    // No event handlers and no style attribute anywhere.
    for (const el of Array.from(host.querySelectorAll("*"))) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name.toLowerCase().startsWith("on")).toBe(false);
        expect(attr.name.toLowerCase()).not.toBe("style");
      }
    }
    const lower = host.innerHTML.toLowerCase();
    expect(lower).not.toContain("javascript:");
    expect(lower).not.toContain("vbscript:");
    expect(lower).not.toContain("data:text/html");
  }

  it("removes <script> tags entirely (HTML namespace)", () => {
    const host = liveSanitize("<p>hi</p><script>window.x=1</script>");
    expect(host.querySelector("p")?.textContent).toBe("hi");
    assertNoDangerousMarkup(host);
    expect(host.innerHTML).not.toContain("window.x=1");
  });

  it("strips on* event-handler attributes (img onerror)", () => {
    const host = liveSanitize('<img src="https://x/y.png" onerror="alert(1)">');
    assertNoDangerousMarkup(host);
    expect(host.innerHTML).not.toContain("alert(1)");
  });

  // --- C1: SVG/MathML-namespaced elements report a lowercase tagName. The old
  // uppercase-Set check let these through. ---

  it("C1: removes <svg><script> (SVG-namespaced script)", () => {
    const host = liveSanitize("<svg><script>alert(1)</script></svg>");
    assertNoDangerousMarkup(host);
    expect(host.innerHTML).not.toContain("alert(1)");
  });

  it("C1: removes <svg><style> (SVG-namespaced style)", () => {
    const host = liveSanitize("<svg><style>* { background: red }</style></svg>");
    assertNoDangerousMarkup(host);
  });

  it("C1: removes a MathML vector", () => {
    const host = liveSanitize(
      '<math><maction actiontype="statusline#http://x" xlink:href="javascript:alert(1)">click</maction></math>',
    );
    assertNoDangerousMarkup(host);
    expect(host.querySelector("maction")).toBeNull();
    expect(host.innerHTML).not.toContain("alert(1)");
  });

  // --- C2: only {href,src,xlink:href} were scheme-checked and `style` was never
  // filtered, so animate@attributeName and style:url(javascript:) survived. ---

  it("C2: removes <svg><a><animate> attribute-name smuggling", () => {
    const host = liveSanitize(
      '<svg><a><animate attributeName="href" values="javascript:alert(1)"/></a></svg>',
    );
    assertNoDangerousMarkup(host);
    expect(host.innerHTML).not.toContain("alert(1)");
  });

  it("C2: strips style attribute with CSS url(javascript:) vector", () => {
    const host = liveSanitize('<div style="background:url(javascript:alert(1))">x</div>');
    assertNoDangerousMarkup(host);
    expect(host.innerHTML).not.toContain("alert(1)");
  });

  it("strips javascript: URLs from href", () => {
    const host = liveSanitize('<a href="javascript:alert(1)">x</a>');
    assertNoDangerousMarkup(host);
    // Anchor text preserved; the dangerous href dropped.
    expect(host.querySelector("a")?.getAttribute("href")).toBeNull();
  });

  it("removes <iframe>", () => {
    const host = liveSanitize('<iframe src="https://evil.example"></iframe>');
    assertNoDangerousMarkup(host);
  });

  // --- Safe content must be preserved so the public page still renders. ---

  it("keeps safe paragraphs, links, images, bold and headings", () => {
    const host = liveSanitize(
      '<h1>Title</h1><p>Body <strong>bold</strong></p>' +
        '<a href="https://example.com">link</a>' +
        '<img src="https://cdn.example/p.png" alt="pic">',
    );
    expect(host.querySelector("h1")?.textContent).toBe("Title");
    expect(host.querySelector("p")?.textContent).toContain("Body");
    expect(host.querySelector("strong")?.textContent).toBe("bold");
    const a = host.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://example.com");
    // Links are hardened to open safely.
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
    const img = host.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.example/p.png");
    expect(img?.getAttribute("alt")).toBe("pic");
    assertNoDangerousMarkup(host);
  });
});

describe("publicSlugFromPath", () => {
  it("matches /public/:slug and decodes", () => {
    expect(publicSlugFromPath("/public/my-page")).toBe("my-page");
    expect(publicSlugFromPath("/public/my-page/")).toBe("my-page");
    expect(publicSlugFromPath("/")).toBeNull();
    expect(publicSlugFromPath("/pages/x")).toBeNull();
  });
});

describe("PublicPageView", () => {
  function fetcher(page: PublicPage) {
    return vi.fn(async () => page);
  }

  it("renders the fetched title and sanitized body (no script executed/rendered)", async () => {
    const executed = vi.fn();
    (window as unknown as { __pwn: () => void }).__pwn = executed;

    const fetchPage = fetcher({
      title: "Hello World",
      html: '<p>Body text</p><script>window.__pwn()</script><img src="x" onerror="window.__pwn()">',
      includeSubpages: false,
      allowDuplicate: false,
    });

    render(<PublicPageView slug="hello-world" fetcher={fetchPage} />);

    await waitFor(() => expect(screen.getByTestId("public-title")).toHaveTextContent("Hello World"));
    const body = screen.getByTestId("public-body");
    expect(body).toHaveTextContent("Body text");
    // The active markup must NOT be present in the live DOM.
    expect(body.querySelector("script")).toBeNull();
    const img = body.querySelector("img");
    expect(img?.getAttribute("onerror")).toBeNull();
    // And no injected handler ever ran.
    expect(executed).not.toHaveBeenCalled();
  });

  it("renders subpage links when present", async () => {
    const fetchPage = fetcher({
      title: "Root",
      html: "<p>x</p>",
      includeSubpages: true,
      allowDuplicate: false,
      subpages: [{ slug: "child-1", title: "Child One" }],
    });
    render(<PublicPageView slug="root" fetcher={fetchPage} />);
    const link = await screen.findByRole("link", { name: "Child One" });
    expect(link).toHaveAttribute("href", "/public/child-1");
  });

  it("shows a not-found state when the fetch rejects", async () => {
    const fetchPage = vi.fn(async () => {
      throw new Error("not-found");
    });
    render(<PublicPageView slug="missing" fetcher={fetchPage} />);
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
  });
});
