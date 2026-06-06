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
  it("removes <script> tags entirely", () => {
    const out = sanitizeHtml('<p>hi</p><script>window.x=1</script>');
    expect(out).toContain("<p>hi</p>");
    expect(out.toLowerCase()).not.toContain("<script");
    expect(out).not.toContain("window.x=1");
  });

  it("strips on* event-handler attributes", () => {
    const out = sanitizeHtml('<img src="https://x/y.png" onerror="alert(1)">');
    expect(out.toLowerCase()).not.toContain("onerror");
    expect(out).not.toContain("alert(1)");
  });

  it("strips javascript: URLs from href", () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out.toLowerCase()).not.toContain("javascript:");
  });

  it("keeps safe http links and text", () => {
    const out = sanitizeHtml('<a href="https://example.com">link</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain("link");
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
