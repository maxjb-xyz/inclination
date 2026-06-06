import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../src/pages/Sidebar";
import { createPublishingApi } from "../src/api/publishingApi";
import { createApiClient, type SessionStore } from "../src/api/apiClient";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const baseProps = {
  pages: [],
  activePageId: null,
  onSelect: vi.fn(),
  onCreateRoot: vi.fn(),
  onCreateChild: vi.fn(),
  onArchive: vi.fn(),
  onMove: vi.fn(),
  onOpenTrash: vi.fn(),
};

describe("Sidebar Markdown import", () => {
  it("reads the selected file's text and calls onImport(filename, markdown)", async () => {
    const onImport = vi.fn();
    const u = userEvent.setup();
    render(<Sidebar {...baseProps} onImport={onImport} />);

    const input = screen.getByTestId("import-md-input") as HTMLInputElement;
    const file = new File(["# Title\n\nBody"], "notes.md", { type: "text/markdown" });
    await u.upload(input, file);

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport).toHaveBeenCalledWith("notes.md", "# Title\n\nBody");
  });
});

describe("publishingApi.importMarkdown", () => {
  it("POSTs { filename, markdown } and returns the created tree", async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? "GET",
        url,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      });
      return new Response(
        JSON.stringify({ id: "page-root", title: "Title", children: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const store: SessionStore = {
      getTokens: () => ({ accessToken: "at", refreshToken: "rt" }),
      getUser: () => ({ id: "u1" }) as never,
      setSession: () => {},
      clear: () => {},
    };
    const api = createPublishingApi(createApiClient(store, fetchImpl as unknown as typeof fetch));

    const tree = await api.importMarkdown("ws1", "notes.md", "# Title\n\nBody");
    expect(tree).toMatchObject({ id: "page-root", title: "Title" });
    const post = calls.find((c) => c.url.includes("/import/markdown"));
    expect(post?.method).toBe("POST");
    expect(post?.body).toEqual({ filename: "notes.md", markdown: "# Title\n\nBody" });
  });
});
