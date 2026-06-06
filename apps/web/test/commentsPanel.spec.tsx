import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommentsPanel } from "../src/collab/CommentsPanel";
import { useAuthStore } from "../src/auth/authStore";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAuthStore.setState({
    user: { id: "me", email: "me@x.com", displayName: "Me", avatarUrl: null } as never,
    tokens: { accessToken: "at", refreshToken: "rt" },
  });
});

const COMMENTS = [
  {
    id: "r1",
    pageId: "p1",
    blockAnchor: null,
    threadId: "r1",
    parentCommentId: null,
    authorId: "me",
    body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] },
    resolvedAt: null,
    createdAt: "2026-01-01T00:00:01.000Z",
    author: { id: "me", displayName: "Me", avatarUrl: null },
  },
  {
    id: "r2",
    pageId: "p1",
    blockAnchor: null,
    threadId: "r1",
    parentCommentId: "r1",
    authorId: "other",
    body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi back" }] }] },
    resolvedAt: null,
    createdAt: "2026-01-01T00:00:02.000Z",
    author: { id: "other", displayName: "Other", avatarUrl: null },
  },
];

function mockFetch(routes: Record<string, unknown>, record?: (c: { method: string; url: string; body: unknown }) => void) {
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

function renderPanel(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("CommentsPanel", () => {
  it("groups threads (root + reply) and renders comment text", async () => {
    vi.stubGlobal("fetch", mockFetch({ "GET /pages/p1/comments": COMMENTS }));
    renderPanel(
      <CommentsPanel pageId="p1" workspaceId="ws1" canComment canWrite onClose={() => {}} />,
    );
    await waitFor(() => expect(screen.getByTestId("comment-thread")).toBeInTheDocument());
    const comments = screen.getAllByTestId("comment");
    expect(comments).toHaveLength(2);
    expect(comments[0]).toHaveTextContent("Hello");
    expect(comments[1]).toHaveTextContent("Hi back");
  });

  it("submits a new comment via the composer (POST /comments)", async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      mockFetch(
        {
          "GET /pages/p1/comments": [],
          "POST /pages/p1/comments": { ...COMMENTS[0], id: "new" },
        },
        (c) => calls.push(c),
      ),
    );
    const u = userEvent.setup();
    renderPanel(
      <CommentsPanel pageId="p1" workspaceId="ws1" canComment canWrite onClose={() => {}} />,
    );
    await screen.findByTestId("comment-composer");
    await u.type(screen.getByLabelText("Comment text"), "A new comment");
    await u.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST");
      expect(post?.url).toContain("/pages/p1/comments");
      expect(post?.body).toMatchObject({ body: { type: "doc" } });
    });
  });

  it("hides the composer when the user cannot comment (read-only)", async () => {
    vi.stubGlobal("fetch", mockFetch({ "GET /pages/p1/comments": COMMENTS }));
    renderPanel(
      <CommentsPanel
        pageId="p1"
        workspaceId="ws1"
        canComment={false}
        canWrite={false}
        onClose={() => {}}
      />,
    );
    await screen.findByTestId("comments-panel");
    expect(screen.queryByTestId("comment-composer")).not.toBeInTheDocument();
    expect(screen.getByText(/view comments but not post/i)).toBeInTheDocument();
  });
});
