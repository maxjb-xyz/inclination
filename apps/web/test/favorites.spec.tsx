import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FavoriteButton } from "../src/pages/FavoriteButton";
import { FavoritesSection, RecentsSection } from "../src/pages/SidebarFavorites";
import { favoriteKeys } from "../src/pages/favoritesQueries";
import type { Favorite, Recent } from "../src/api/types";
import { useAuthStore } from "../src/auth/authStore";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAuthStore.setState({
    user: { id: "me", email: "me@x.com", displayName: "Me", avatarUrl: null } as never,
    tokens: { accessToken: "at", refreshToken: "rt" },
  });
});

function mockFetch(routes: Record<string, unknown>, record?: (c: { method: string; url: string }) => void) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    record?.({ method, url });
    const key = `${method} ${url.replace(/^.*\/api/, "")}`;
    const data = routes[key] ?? null;
    const status = data === null ? 204 : 200;
    return new Response(data === null ? null : JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
}

function renderWithClient(ui: React.ReactElement, qc?: QueryClient) {
  const client = qc ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return client;
}

const FAVORITES: Favorite[] = [{ pageId: "p1", title: "Roadmap", icon: "🗺", order: 0 }];
const RECENTS: Recent[] = [
  { pageId: "p2", title: "Notes", icon: null, visitedAt: "2026-01-01T00:00:00.000Z" },
];

describe("FavoriteButton", () => {
  it("calls POST /pages/:id/favorite when starring an unfavorited page (optimistic)", async () => {
    const calls: { method: string; url: string }[] = [];
    // The server reflects the favorite back after the POST so the re-fetch
    // confirms the optimistic update.
    let favs: Favorite[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url });
      const key = `${method} ${url.replace(/^.*\/api/, "")}`;
      if (key === "POST /pages/p9/favorite") {
        favs = [{ pageId: "p9", title: "Doc", icon: null, order: 0 }];
        return new Response(null, { status: 204 });
      }
      if (key === "GET /favorites") {
        return new Response(JSON.stringify(favs), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchImpl);
    const u = userEvent.setup();
    const qc = renderWithClient(<FavoriteButton pageId="p9" title="Doc" icon={null} />);

    // Wait for the favorites query to settle (empty → not favorite).
    await waitFor(() => expect(qc.getQueryData(favoriteKeys.favorites)).toEqual([]));
    await u.click(screen.getByTestId("favorite-button"));

    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "POST" && c.url.includes("/pages/p9/favorite")),
      ).toBe(true),
    );
    // The page ends up favorited (optimistic add, confirmed by the re-fetch).
    await waitFor(() => {
      const cached = qc.getQueryData<Favorite[]>(favoriteKeys.favorites) ?? [];
      expect(cached.some((f) => f.pageId === "p9")).toBe(true);
    });
  });

  it("calls DELETE /pages/:id/favorite when unstarring a favorited page", async () => {
    const calls: { method: string; url: string }[] = [];
    vi.stubGlobal("fetch", mockFetch({ "GET /favorites": FAVORITES }, (c) => calls.push(c)));
    const u = userEvent.setup();
    renderWithClient(<FavoriteButton pageId="p1" title="Roadmap" icon="🗺" />);

    await waitFor(() => expect(screen.getByTestId("favorite-button")).toHaveAttribute("aria-pressed", "true"));
    await u.click(screen.getByTestId("favorite-button"));

    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "DELETE" && c.url.includes("/pages/p1/favorite")),
      ).toBe(true),
    );
  });
});

describe("FavoritesSection / RecentsSection", () => {
  it("renders favorites and navigates on click", async () => {
    vi.stubGlobal("fetch", mockFetch({ "GET /favorites": FAVORITES }));
    const onSelect = vi.fn();
    const u = userEvent.setup();
    renderWithClient(<FavoritesSection onSelect={onSelect} />);

    const item = await screen.findByTestId("favorite-item");
    expect(item).toHaveTextContent("Roadmap");
    await u.click(item);
    expect(onSelect).toHaveBeenCalledWith("p1");
  });

  it("renders recents and navigates on click", async () => {
    vi.stubGlobal("fetch", mockFetch({ "GET /recents": RECENTS }));
    const onSelect = vi.fn();
    const u = userEvent.setup();
    renderWithClient(<RecentsSection onSelect={onSelect} />);

    const item = await screen.findByTestId("recent-item");
    expect(item).toHaveTextContent("Notes");
    await u.click(item);
    expect(onSelect).toHaveBeenCalledWith("p2");
  });

  it("renders nothing when there are no favorites", async () => {
    vi.stubGlobal("fetch", mockFetch({ "GET /favorites": [] }));
    const qc = renderWithClient(<FavoritesSection onSelect={vi.fn()} />);
    await waitFor(() => expect(qc.getQueryData(favoriteKeys.favorites)).toEqual([]));
    expect(screen.queryByTestId("favorites-section")).toBeNull();
  });
});
