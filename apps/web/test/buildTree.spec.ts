import { describe, expect, it } from "vitest";
import { buildTree } from "../src/pages/buildTree";
import type { Page } from "../src/api/types";

function page(overrides: Partial<Page> & { id: string; sortKey: string }): Page {
  return {
    workspaceId: "ws",
    parentId: null,
    type: "document",
    title: overrides.id,
    icon: null,
    cover: null,
    archivedAt: null,
    createdById: "u",
    editedById: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildTree", () => {
  it("nests children under parents and orders by sortKey", () => {
    const flat: Page[] = [
      page({ id: "b", sortKey: "a1" }),
      page({ id: "a", sortKey: "a0" }),
      page({ id: "a-child-2", parentId: "a", sortKey: "m2" }),
      page({ id: "a-child-1", parentId: "a", sortKey: "m1" }),
    ];

    const tree = buildTree(flat);

    expect(tree.map((n) => n.id)).toEqual(["a", "b"]);
    const a = tree[0]!;
    expect(a.children.map((n) => n.id)).toEqual(["a-child-1", "a-child-2"]);
    expect(tree[1]!.children).toEqual([]);
  });

  it("treats pages with a missing parent as roots", () => {
    const flat: Page[] = [page({ id: "orphan", parentId: "ghost", sortKey: "a0" })];
    const tree = buildTree(flat);
    expect(tree.map((n) => n.id)).toEqual(["orphan"]);
  });
});
