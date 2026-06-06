import type { PageNode } from "../api/types";

export interface FlatItem {
  id: string;
  parentId: string | null;
  depth: number;
  title: string;
  icon: string | null;
  hasChildren: boolean;
  /** ordered sibling ids under this item's parent (for before/after lookup) */
}

/**
 * Flattens a nested tree into a depth-annotated list in display order,
 * skipping the subtrees of collapsed nodes. Used for the sortable sidebar.
 */
export function flattenTree(
  nodes: PageNode[],
  collapsed: ReadonlySet<string>,
  depth = 0,
): FlatItem[] {
  const out: FlatItem[] = [];
  for (const node of nodes) {
    out.push({
      id: node.id,
      parentId: node.parentId,
      depth,
      title: node.title,
      icon: node.icon,
      hasChildren: node.children.length > 0,
    });
    if (node.children.length > 0 && !collapsed.has(node.id)) {
      out.push(...flattenTree(node.children, collapsed, depth + 1));
    }
  }
  return out;
}
