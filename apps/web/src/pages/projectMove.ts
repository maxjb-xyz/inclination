import type { MovePageInput } from "@inclination/shared";
import type { Page } from "../api/types";
import { buildTree } from "./buildTree";

export interface MovePlan {
  parentId: string | null;
  input: MovePageInput;
}

/**
 * Computes a move payload for dropping `activeId` immediately before `overId`
 * in the flattened display order. The dropped page adopts `overId`'s parent
 * (a sibling reorder/reparent). Returns null for no-op or invalid drops
 * (e.g. dropping a page onto its own descendant).
 *
 * The resulting siblings are derived from the *current* flat list excluding
 * the active page; before/after ids are its neighbours under the new parent.
 */
export function projectMove(
  pages: Page[],
  activeId: string,
  overId: string,
): MovePlan | null {
  if (activeId === overId) return null;

  const byId = new Map(pages.map((p) => [p.id, p]));
  const active = byId.get(activeId);
  const over = byId.get(overId);
  if (!active || !over) return null;

  const newParentId = over.parentId;

  // Reject moving a page under its own descendant (or itself).
  if (isDescendant(pages, activeId, newParentId)) return null;

  // Siblings under the new parent, ordered by sortKey, excluding the active page.
  const siblings = pages
    .filter((p) => p.parentId === newParentId && p.id !== activeId)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

  const overIndex = siblings.findIndex((p) => p.id === overId);
  if (overIndex === -1) return null;

  // Insert the active page directly *before* the over item.
  const beforeNeighbour = siblings[overIndex - 1]; // page that ends up above
  const afterNeighbour = siblings[overIndex]; // the over item, ends up below

  const input: MovePageInput = {
    parentId: newParentId,
    beforeId: beforeNeighbour?.id ?? null,
    afterId: afterNeighbour?.id ?? null,
  };

  // No-op: already in this exact position.
  if (active.parentId === newParentId) {
    const ordered = pages
      .filter((p) => p.parentId === newParentId)
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
    const activeIdx = ordered.findIndex((p) => p.id === activeId);
    const overIdx = ordered.findIndex((p) => p.id === overId);
    if (activeIdx !== -1 && overIdx === activeIdx + 1) return null;
  }

  return { parentId: newParentId, input };
}

/** True if `parentId` is `pageId` or sits within `pageId`'s subtree. */
function isDescendant(pages: Page[], pageId: string, parentId: string | null): boolean {
  if (parentId === null) return false;
  if (parentId === pageId) return true;
  // Walk down the subtree of pageId.
  const tree = buildTree(pages);
  const stack = [...tree.filter((n) => n.id === pageId)];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.id === parentId) return true;
    stack.push(...node.children);
  }
  return false;
}
