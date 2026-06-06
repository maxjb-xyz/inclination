import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationsBell } from "../src/collab/NotificationsBell";
import { useAuthStore } from "../src/auth/authStore";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAuthStore.setState({
    user: { id: "me", email: "me@x.com", displayName: "Me", avatarUrl: null } as never,
    tokens: { accessToken: "at", refreshToken: "rt" },
  });
});

const NOTIFS = [
  {
    id: "n1",
    recipientId: "me",
    type: "mention",
    sourceRef: { pageId: "p7", commentId: "c1" },
    readAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    preview: { pageTitle: "Roadmap" },
  },
];

function mockFetch(routes: Record<string, unknown>, record?: (c: { method: string; url: string }) => void) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    record?.({ method, url });
    const key = `${method} ${url.replace(/^.*\/api/, "")}`;
    const data = routes[key] ?? {};
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

function renderBell(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("NotificationsBell", () => {
  it("shows an unread badge and lists notifications on open", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "GET /notifications/unread-count": { count: 1 },
        "GET /notifications": NOTIFS,
      }),
    );
    const u = userEvent.setup();
    renderBell(<NotificationsBell onOpenPage={() => {}} />);

    await waitFor(() => expect(screen.getByTestId("notifications-badge")).toHaveTextContent("1"));

    await u.click(screen.getByTestId("notifications-bell"));
    const item = await screen.findByTestId("notification-item");
    expect(item).toHaveTextContent(/mentioned you/);
    expect(item).toHaveTextContent("Roadmap");
  });

  it("marks read and opens the referenced page on click", async () => {
    const calls: { method: string; url: string }[] = [];
    const onOpenPage = vi.fn();
    vi.stubGlobal(
      "fetch",
      mockFetch(
        {
          "GET /notifications/unread-count": { count: 1 },
          "GET /notifications": NOTIFS,
          "POST /notifications/n1/read": { ...NOTIFS[0], readAt: "2026-01-02T00:00:00.000Z" },
        },
        (c) => calls.push(c),
      ),
    );
    const u = userEvent.setup();
    renderBell(<NotificationsBell onOpenPage={onOpenPage} />);

    await u.click(screen.getByTestId("notifications-bell"));
    const item = await screen.findByTestId("notification-item");
    await u.click(item);

    await waitFor(() => {
      expect(calls.some((c) => c.method === "POST" && c.url.includes("/notifications/n1/read"))).toBe(true);
    });
    expect(onOpenPage).toHaveBeenCalledWith("p7");
  });

  it("marks all read", async () => {
    const calls: { method: string; url: string }[] = [];
    vi.stubGlobal(
      "fetch",
      mockFetch(
        {
          "GET /notifications/unread-count": { count: 2 },
          "GET /notifications": NOTIFS,
          "POST /notifications/read-all": { updated: 2 },
        },
        (c) => calls.push(c),
      ),
    );
    const u = userEvent.setup();
    renderBell(<NotificationsBell onOpenPage={() => {}} />);
    await u.click(screen.getByTestId("notifications-bell"));
    await u.click(await screen.findByRole("button", { name: "Mark all read" }));
    await waitFor(() => {
      expect(calls.some((c) => c.url.includes("/notifications/read-all"))).toBe(true);
    });
  });
});
