import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../src/auth/authStore";
import { VersionHistoryPanel } from "../src/pages/VersionHistoryPanel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAuthStore.setState({
    user: { id: "me", email: "me@x.com", displayName: "Me", avatarUrl: null } as never,
    tokens: { accessToken: "at", refreshToken: "rt" },
  });
});

const SNAPSHOTS = [
  { id: "s1", label: "First", authorId: "me", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "s2", label: null, authorId: "me", createdAt: "2026-02-01T00:00:00.000Z" },
];

/** Mock fetch for the snapshot endpoints; records POST calls for assertions. */
function mockFetch(posts: { method: string; path: string }[]) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = String(url).replace(/^.*\/api/, "").split("?")[0]!;
    if (method !== "GET") posts.push({ method, path });

    let data: unknown = {};
    if (method === "GET" && path === "/pages/p1/snapshots") data = SNAPSHOTS;
    else if (method === "GET" && /\/snapshots\/s\d$/.test(path))
      data = { text: "snapshot preview text", decoded: false, doc: null };
    else if (method === "POST" && path === "/pages/p1/snapshots")
      data = { id: "s3", label: null, authorId: "me", createdAt: "2026-03-01T00:00:00.000Z" };
    else if (method === "POST" && /\/restore$/.test(path)) data = { restored: true };

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

function renderPanel(canWrite: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <VersionHistoryPanel pageId="p1" canWrite={canWrite} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe("VersionHistoryPanel", () => {
  it("lists snapshots from the query", async () => {
    vi.stubGlobal("fetch", mockFetch([]));
    renderPanel(true);
    await waitFor(() => expect(screen.getAllByTestId("version-item").length).toBe(2));
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Untitled version")).toBeInTheDocument();
  });

  it("Restore calls the restore endpoint", async () => {
    const posts: { method: string; path: string }[] = [];
    vi.stubGlobal("fetch", mockFetch(posts));
    const user = userEvent.setup();
    renderPanel(true);
    await waitFor(() => expect(screen.getAllByTestId("version-restore").length).toBe(2));

    await user.click(screen.getAllByTestId("version-restore")[0]!);
    await waitFor(() =>
      expect(posts).toContainEqual({ method: "POST", path: "/pages/p1/snapshots/s1/restore" }),
    );
  });

  it("Save creates a snapshot", async () => {
    const posts: { method: string; path: string }[] = [];
    vi.stubGlobal("fetch", mockFetch(posts));
    const user = userEvent.setup();
    renderPanel(true);
    await screen.findByTestId("version-save");

    await user.click(screen.getByTestId("version-save"));
    await waitFor(() =>
      expect(posts).toContainEqual({ method: "POST", path: "/pages/p1/snapshots" }),
    );
  });

  it("shows a read-only preview when a version is selected", async () => {
    vi.stubGlobal("fetch", mockFetch([]));
    const user = userEvent.setup();
    renderPanel(true);
    await waitFor(() => expect(screen.getAllByTestId("version-item-select").length).toBe(2));

    await user.click(screen.getAllByTestId("version-item-select")[0]!);
    await waitFor(() =>
      expect(screen.getByTestId("version-preview")).toHaveTextContent("snapshot preview text"),
    );
  });

  it("hides Save and Restore when the user lacks write access", async () => {
    vi.stubGlobal("fetch", mockFetch([]));
    renderPanel(false);
    await waitFor(() => expect(screen.getAllByTestId("version-item").length).toBe(2));
    expect(screen.queryByTestId("version-save")).not.toBeInTheDocument();
    expect(screen.queryByTestId("version-restore")).not.toBeInTheDocument();
  });
});
