import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareDialog } from "../src/collab/ShareDialog";
import { useAuthStore } from "../src/auth/authStore";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAuthStore.setState({
    user: { id: "owner", email: "o@x.com", displayName: "Owner", avatarUrl: null } as never,
    tokens: { accessToken: "at", refreshToken: "rt" },
  });
});

/** Build a fetch mock that routes by method + path suffix. */
function mockFetch(routes: Record<string, unknown>, record?: (call: { method: string; url: string; body: unknown }) => void) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    record?.({ method, url, body });
    const key = `${method} ${url.replace(/^.*\/api/, "")}`;
    const data = routes[key] ?? routes[url] ?? {};
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

describe("ShareDialog", () => {
  it("lists current permissions with subject info", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "GET /pages/p1/permissions": [
          {
            id: "g1",
            pageId: "p1",
            subjectType: "user",
            subjectId: "u2",
            role: "read",
            createdAt: "2026-01-01T00:00:00.000Z",
            subject: { kind: "user", id: "u2", displayName: "Bob", email: "bob@x.com", avatarUrl: null },
          },
        ],
      }),
    );
    renderWithQuery(<ShareDialog pageId="p1" workspaceId="ws1" onClose={() => {}} />);
    const row = await screen.findByTestId("share-row");
    expect(row).toHaveTextContent("Bob");
  });

  it("invites a person by email (POST /share-invite)", async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      mockFetch(
        {
          "GET /pages/p1/permissions": [],
          "POST /pages/p1/share-invite": { kind: "granted", userId: "u9", permissionId: "g9", role: "read", guest: true },
        },
        (c) => calls.push(c),
      ),
    );
    const u = userEvent.setup();
    renderWithQuery(<ShareDialog pageId="p1" workspaceId="ws1" onClose={() => {}} />);

    await u.type(screen.getByLabelText("Invite by email"), "carol@x.com");
    await u.click(screen.getByRole("button", { name: "Invite" }));

    await waitFor(() => {
      const invite = calls.find((c) => c.url.includes("/share-invite"));
      expect(invite).toBeDefined();
      expect(invite!.body).toMatchObject({ email: "carol@x.com" });
    });
  });

  it("removes a permission (DELETE)", async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      mockFetch(
        {
          "GET /pages/p1/permissions": [
            {
              id: "g1",
              pageId: "p1",
              subjectType: "user",
              subjectId: "u2",
              role: "read",
              createdAt: "2026-01-01T00:00:00.000Z",
              subject: { kind: "user", id: "u2", displayName: "Bob", email: "bob@x.com", avatarUrl: null },
            },
          ],
          "DELETE /pages/p1/permissions/g1": { deleted: 1, id: "g1" },
        },
        (c) => calls.push(c),
      ),
    );
    const u = userEvent.setup();
    renderWithQuery(<ShareDialog pageId="p1" workspaceId="ws1" onClose={() => {}} />);
    await screen.findByTestId("share-row");
    await u.click(screen.getByRole("button", { name: /Remove Bob/ }));
    await waitFor(() => {
      const del = calls.find((c) => c.method === "DELETE");
      expect(del?.url).toContain("/pages/p1/permissions/g1");
    });
  });
});
