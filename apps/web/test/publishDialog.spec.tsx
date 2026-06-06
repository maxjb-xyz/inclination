import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublishDialog } from "../src/publish/PublishDialog";
import { useAuthStore } from "../src/auth/authStore";

beforeEach(() => {
  useAuthStore.setState({
    user: { id: "owner", email: "o@x.com", displayName: "Owner", avatarUrl: null } as never,
    tokens: { accessToken: "at", refreshToken: "rt" },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockFetch(
  routes: Record<string, unknown>,
  record?: (call: { method: string; url: string; body: unknown }) => void,
) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    record?.({ method, url, body });
    const key = `${method} ${url.replace(/^.*\/api/, "")}`;
    const data = routes[key] ?? {};
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("PublishDialog", () => {
  it("shows the unpublished state and publishes (serializes HTML + POSTs)", async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      mockFetch(
        {
          "GET /pages/p1/public-share": null,
          "POST /pages/p1/publish": {
            slug: "my-page",
            published: true,
            includeSubpages: true,
            allowDuplicate: false,
            title: "My Page",
          },
        },
        (c) => calls.push(c),
      ),
    );
    const getHtml = vi.fn(() => "<p>Serialized body</p>");
    const u = userEvent.setup();
    renderWithQuery(
      <PublishDialog pageId="p1" title="My Page" getHtml={getHtml} onClose={() => {}} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("publish-state")).toHaveTextContent("This page is private."),
    );

    await u.click(screen.getByLabelText("Include subpages"));
    await u.click(screen.getByTestId("publish-button"));

    await waitFor(() => {
      const pub = calls.find((c) => c.url.includes("/publish"));
      expect(pub).toBeDefined();
    });
    const pub = calls.find((c) => c.url.includes("/publish"))!;
    expect(getHtml).toHaveBeenCalled();
    expect(pub.body).toMatchObject({
      html: "<p>Serialized body</p>",
      title: "My Page",
      includeSubpages: true,
    });

    // After publishing, the public URL is shown.
    await waitFor(() => expect(screen.getByTestId("public-url")).toBeInTheDocument());
    expect(screen.getByLabelText("Public URL")).toHaveValue(
      `${window.location.origin}/public/my-page`,
    );
  });

  it("shows published state with the public URL and unpublishes", async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      mockFetch(
        {
          "GET /pages/p1/public-share": {
            slug: "live-page",
            published: true,
            includeSubpages: false,
            allowDuplicate: false,
            title: "Live Page",
          },
          "POST /pages/p1/unpublish": { published: false },
        },
        (c) => calls.push(c),
      ),
    );
    const u = userEvent.setup();
    renderWithQuery(
      <PublishDialog pageId="p1" title="Live Page" getHtml={() => "<p>x</p>"} onClose={() => {}} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("publish-state")).toHaveTextContent("live on the web"),
    );
    expect(screen.getByLabelText("Public URL")).toHaveValue(
      `${window.location.origin}/public/live-page`,
    );

    await u.click(screen.getByTestId("unpublish-button"));
    await waitFor(() => {
      const unpub = calls.find((c) => c.url.includes("/unpublish"));
      expect(unpub?.method).toBe("POST");
    });
  });
});
