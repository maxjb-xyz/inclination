import { describe, expect, it, vi } from "vitest";
import {
  mapMentionableToItems,
  mapPagesToPageLinkItems,
  runMentionCommand,
} from "../src/editor/mentionSuggestion";
import type { MentionableResult } from "../src/api/types";

const result: MentionableResult = {
  users: [{ id: "u1", displayName: "Alice", email: "a@b.com", kind: "user" }],
  pages: [
    { id: "p1", title: "Roadmap", icon: "🗺️", kind: "page" },
    { id: "p2", title: "", icon: null, kind: "page" },
  ],
};

describe("@-mention item mapping", () => {
  it("maps users then pages to mention items with correct node attrs", () => {
    const items = mapMentionableToItems(result);

    // Users come first, inserted as user mentions.
    expect(items[0]).toMatchObject({
      id: "u1",
      label: "Alice",
      hint: "a@b.com",
      command: { node: "mention", attrs: { kind: "user", id: "u1", label: "Alice" } },
    });
    // Pages follow, inserted as page mentions; blank title falls back to Untitled.
    expect(items[1]!.command).toEqual({
      node: "mention",
      attrs: { kind: "page", id: "p1", label: "Roadmap" },
    });
    expect(items[2]!.command).toEqual({
      node: "mention",
      attrs: { kind: "page", id: "p2", label: "Untitled" },
    });
  });
});

describe("[[ page-link item mapping", () => {
  it("maps only pages to pageLink items (users excluded)", () => {
    const items = mapPagesToPageLinkItems(result);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.command.node === "pageLink")).toBe(true);
    expect(items[0]!.command).toEqual({
      node: "pageLink",
      attrs: { pageId: "p1", label: "Roadmap" },
    });
  });
});

describe("runMentionCommand", () => {
  function makeEditor() {
    const calls: { name: string; args: unknown[] }[] = [];
    const chain = {
      focus: (...a: unknown[]) => (calls.push({ name: "focus", args: a }), chain),
      insertContentAt: (...a: unknown[]) => (
        calls.push({ name: "insertContentAt", args: a }), chain
      ),
      run: () => (calls.push({ name: "run", args: [] }), true),
    };
    const editor = { chain: () => chain } as never;
    return { editor, calls };
  }

  it("replaces the trigger range with the mention node + trailing space", () => {
    const { editor, calls } = makeEditor();
    runMentionCommand(editor, { from: 3, to: 8 }, {
      node: "mention",
      attrs: { kind: "page", id: "p1", label: "Roadmap" },
    });

    const insert = calls.find((c) => c.name === "insertContentAt")!;
    expect(insert.args[0]).toEqual({ from: 3, to: 8 });
    expect(insert.args[1]).toEqual([
      { type: "mention", attrs: { kind: "page", id: "p1", label: "Roadmap" } },
      { type: "text", text: " " },
    ]);
  });

  it("inserts a pageLink node for a page-link payload", () => {
    const { editor, calls } = makeEditor();
    runMentionCommand(editor, { from: 1, to: 4 }, {
      node: "pageLink",
      attrs: { pageId: "p9", label: "Specs" },
    });
    const insert = calls.find((c) => c.name === "insertContentAt")!;
    expect((insert.args[1] as unknown[])[0]).toEqual({
      type: "pageLink",
      attrs: { pageId: "p9", label: "Specs" },
    });
  });
});

describe("searchMentionable wiring (via pagesApi)", () => {
  it("calls the mentionable endpoint with the workspace id + query", async () => {
    const { createPagesApi } = await import("../src/api/pagesApi");
    const get = vi.fn(async () => result);
    const api = createPagesApi({ get } as never);

    await api.searchMentionable("ws-7", "ali ce");

    expect(get).toHaveBeenCalledWith(
      "/workspaces/ws-7/search/mentionable?q=ali%20ce",
    );
  });
});
