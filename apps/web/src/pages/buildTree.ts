import type { Page, PageNode } from "../api/types";

/**
 * Builds a nested page tree from a flat list. Children of each parent are
 * ordered by their fractional-index `sortKey` (lexicographic). Pages whose
 * parent is missing from the list are treated as roots so nothing is dropped.
 */
export function buildTree(pages: Page[]): PageNode[] {
  const byId = new Map<string, PageNode>();
  for (const page of pages) {
    byId.set(page.id, { ...page, children: [] });
  }

  const roots: PageNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortBySortKey = (a: PageNode, b: PageNode): number =>
    a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;

  const sortRecursive = (nodes: PageNode[]): void => {
    nodes.sort(sortBySortKey);
    for (const n of nodes) sortRecursive(n.children);
  };
  sortRecursive(roots);

  return roots;
}
