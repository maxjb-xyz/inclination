import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../src/auth/authStore";

// The editor + collab session are heavy (Yjs/websocket/ProseMirror) and not the
// subject here — stub them so we can assert capability-gated affordances. The
// stub Editor records the `editable` prop it received.
const editorProps: { editable?: boolean }[] = [];
vi.mock("../src/pages/Editor", () => ({
  Editor: (props: { editable?: boolean }) => {
    editorProps.push(props);
    return <div data-testid="stub-editor" data-editable={String(props.editable)} />;
  },
}));
vi.mock("../src/collab/useCollabSession", () => ({
  useCollabSession: () => ({
    session: { doc: {}, provider: {}, pageId: "p1", destroy: () => {} },
    status: "connected",
    peers: 0,
  }),
}));

import { PageView } from "../src/pages/PageView";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  editorProps.length = 0;
  useAuthStore.setState({
    user: { id: "me", email: "me@x.com", displayName: "Me", avatarUrl: null } as never,
    tokens: { accessToken: "at", refreshToken: "rt" },
  });
});

const PAGE = {
  id: "p1",
  workspaceId: "ws1",
  parentId: null,
  type: "document",
  title: "Doc",
  icon: null,
  cover: null,
  sortKey: "a0",
  archivedAt: null,
  createdById: "me",
  editedById: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

interface AccessShape {
  role: string;
  canRead: boolean;
  canComment: boolean;
  canWrite: boolean;
  canShare: boolean;
}

function mockFetch(access: AccessShape) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = String(url).replace(/^.*\/api/, "");
    let data: unknown = {};
    if (method === "GET" && path === "/pages/p1") data = { page: PAGE, breadcrumbs: [] };
    else if (method === "GET" && path === "/pages/p1/access") data = access;
    else if (method === "GET" && path === "/pages/p1/backlinks") data = [];
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PageView workspaceId="ws1" pageId="p1" onNavigate={() => {}} />
    </QueryClientProvider>,
  );
}

describe("PageView capability gating", () => {
  it("shows the Share button and an editable editor for a full-access user", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ role: "full", canRead: true, canComment: true, canWrite: true, canShare: true }),
    );
    renderPage();
    await screen.findByTestId("stub-editor");
    expect(screen.getByTestId("open-share")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("stub-editor")).toHaveAttribute("data-editable", "true"),
    );
    expect((screen.getByLabelText("Page title") as HTMLInputElement).disabled).toBe(false);
  });

  it("hides Share and renders a read-only editor for a read-only user", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ role: "read", canRead: true, canComment: false, canWrite: false, canShare: false }),
    );
    renderPage();
    await screen.findByTestId("stub-editor");
    await waitFor(() =>
      expect(screen.getByTestId("stub-editor")).toHaveAttribute("data-editable", "false"),
    );
    expect(screen.queryByTestId("open-share")).not.toBeInTheDocument();
    expect((screen.getByLabelText("Page title") as HTMLInputElement).disabled).toBe(true);
  });
});
