import { describe, expect, it } from "vitest";
import { projectMove } from "../src/pages/projectMove";
import type { Page } from "../src/api/types";

function page(id: string, parentId: string | null, sortKey: string): Page {
  return {
    id,
    workspaceId: "ws",
    parentId,
    type: "document",
    title: id,
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

describe("projectMove", () => {
  const pages: Page[] = [
    page("a", null, "a0"),
    page("b", null, "a1"),
    page("c", null, "a2"),
    page("a1", "a", "m0"),
  ];

  it("reorders a root sibling before another", () => {
    const plan = projectMove(pages, "c", "a");
    expect(plan).not.toBeNull();
    expect(plan!.parentId).toBeNull();
    // c goes before a -> beforeId null (top), afterId a
    expect(plan!.input).toEqual({ parentId: null, beforeId: null, afterId: "a" });
  });

  it("reparents a page under a new parent via a child sibling", () => {
    const plan = projectMove(pages, "b", "a1");
    expect(plan).not.toBeNull();
    expect(plan!.parentId).toBe("a");
    expect(plan!.input).toEqual({ parentId: "a", beforeId: null, afterId: "a1" });
  });

  it("rejects dropping a page onto its own descendant", () => {
    const plan = projectMove(pages, "a", "a1");
    expect(plan).toBeNull();
  });

  it("returns null for a no-op (dropping onto self)", () => {
    expect(projectMove(pages, "a", "a")).toBeNull();
  });
});
