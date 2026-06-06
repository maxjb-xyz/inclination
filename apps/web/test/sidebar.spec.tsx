import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../src/pages/Sidebar";
import type { Page } from "../src/api/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The sidebar now hosts Favorites/Recent sections backed by TanStack Query, so
// the standalone render needs a fetch stub (returns empty lists).
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
});

function page(id: string, parentId: string | null, sortKey: string, title: string): Page {
  return {
    id,
    workspaceId: "ws",
    parentId,
    type: "document",
    title,
    icon: null,
    cover: null,
    sortKey,
    archivedAt: null,
    createdById: "u",
    editedById: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const pages: Page[] = [
  page("a", null, "a0", "Parent"),
  page("a1", "a", "m0", "Child"),
  page("b", null, "a1", "Sibling"),
];

function renderSidebar(overrides: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const props = {
    pages,
    activePageId: null,
    onSelect: vi.fn(),
    onCreateRoot: vi.fn(),
    onCreateChild: vi.fn(),
    onArchive: vi.fn(),
    onMove: vi.fn(),
    onOpenTrash: vi.fn(),
    onImport: vi.fn(),
    ...overrides,
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Sidebar {...props} />
    </QueryClientProvider>,
  );
  return props;
}

describe("Sidebar", () => {
  it("renders the nested tree in sortKey order", () => {
    renderSidebar();
    const rows = screen.getAllByTestId("page-row");
    // display order: Parent, Child (nested), Sibling
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Parent"),
      expect.stringContaining("Child"),
      expect.stringContaining("Sibling"),
    ]);
  });

  it("calls onCreateRoot when the New button is clicked", async () => {
    const u = userEvent.setup();
    const props = renderSidebar();
    await u.click(screen.getByRole("button", { name: "New page" }));
    expect(props.onCreateRoot).toHaveBeenCalledTimes(1);
  });

  it("calls onCreateChild with the parent id from a row's add-subpage button", async () => {
    const u = userEvent.setup();
    const props = renderSidebar();
    const addButtons = screen.getAllByRole("button", { name: "Add subpage" });
    await u.click(addButtons[0]!); // first row is "Parent" (id "a")
    expect(props.onCreateChild).toHaveBeenCalledWith("a");
  });

  it("calls onSelect when a page link is clicked", async () => {
    const u = userEvent.setup();
    const props = renderSidebar();
    await u.click(screen.getByRole("button", { name: /Sibling/ }));
    expect(props.onSelect).toHaveBeenCalledWith("b");
  });
});
