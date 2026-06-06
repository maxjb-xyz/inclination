import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../src/auth/authStore";
import { CommandPalette } from "../src/pages/CommandPalette";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAuthStore.setState({
    user: { id: "me", email: "me@x.com", displayName: "Me", avatarUrl: null } as never,
    tokens: { accessToken: "at", refreshToken: "rt" },
  });
});

const RESULTS = [
  { pageId: "p1", title: "Roadmap", snippet: "the [[roadmap]] for Q3", rank: 0.9 },
  { pageId: "p2", title: "Notes", snippet: "meeting [[notes]]", rank: 0.5 },
];

/** Mock fetch: records the search query string it was called with. */
function mockSearch(seen: string[]) {
  return vi.fn(async (url: string) => {
    const u = new URL(String(url), "http://localhost");
    if (u.pathname.endsWith("/search")) {
      seen.push(u.searchParams.get("q") ?? "");
      return new Response(JSON.stringify(RESULTS), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
}

function renderPalette(overrides: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = {
    workspaceId: "ws1",
    onClose: vi.fn(),
    onOpenPage: vi.fn(),
    onNewPage: vi.fn(),
    onOpenTrash: vi.fn(),
    ...overrides,
  };
  render(
    <QueryClientProvider client={qc}>
      <CommandPalette {...props} />
    </QueryClientProvider>,
  );
  return props;
}

describe("CommandPalette", () => {
  it("debounces input then queries search and renders results with highlighted snippets", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", mockSearch(seen));
    const user = userEvent.setup();
    renderPalette();

    await user.type(screen.getByTestId("command-palette-input"), "road");

    await waitFor(() => expect(screen.getAllByTestId("command-palette-result").length).toBe(2));

    // The search endpoint was hit with the typed query.
    expect(seen.some((q) => q === "road")).toBe(true);

    // Snippet [[ ]] markers render as <mark> highlights (markers stripped).
    const first = screen.getAllByTestId("command-palette-result")[0]!;
    const mark = within(first).getByTestId("snippet-highlight");
    expect(mark.tagName.toLowerCase()).toBe("mark");
    expect(mark).toHaveTextContent("roadmap");
    expect(first).not.toHaveTextContent("[[");
  });

  it("navigates to the first result on Enter", async () => {
    vi.stubGlobal("fetch", mockSearch([]));
    const user = userEvent.setup();
    const props = renderPalette();

    const input = screen.getByTestId("command-palette-input");
    await user.type(input, "road");
    await waitFor(() => expect(screen.getAllByTestId("command-palette-result").length).toBe(2));

    await user.type(input, "{Enter}");
    expect(props.onOpenPage).toHaveBeenCalledWith("p1");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("runs quick actions (New page / Open Trash)", async () => {
    vi.stubGlobal("fetch", mockSearch([]));
    const user = userEvent.setup();
    const props = renderPalette();

    await user.click(screen.getByTestId("command-palette-action-new-page"));
    expect(props.onNewPage).toHaveBeenCalled();

    // Re-render fresh (onClose was called above) to test trash independently.
    cleanup();
    const props2 = renderPalette();
    await user.click(screen.getByTestId("command-palette-action-open-trash"));
    expect(props2.onOpenTrash).toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    vi.stubGlobal("fetch", mockSearch([]));
    const user = userEvent.setup();
    const props = renderPalette();
    await user.type(screen.getByTestId("command-palette-input"), "{Escape}");
    expect(props.onClose).toHaveBeenCalled();
  });
});
