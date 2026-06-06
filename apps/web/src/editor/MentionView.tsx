import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import type { MentionKind } from "@inclination/editor";
import { usePage } from "../pages/queries";
import { useOpenPage } from "./openPageContext";

/**
 * NodeView for the inline `@`-mention node. A `user` mention renders the display
 * name (no navigation). A `page` mention renders the target page's live title
 * (falling back to the stored label) and navigates to it on click — so a page
 * mention behaves like a backlink-creating reference.
 */
export function MentionView({ node }: NodeViewProps): React.ReactElement {
  const kind = (node.attrs.kind as MentionKind) ?? "user";
  const id = (node.attrs.id as string) ?? "";
  const stored = (node.attrs.label as string) || id;
  const openPage = useOpenPage();

  // Only page mentions resolve a page; user mentions skip the query (enabled:false).
  const pageQuery = usePage(kind === "page" ? id : null);

  if (kind === "user") {
    return (
      <NodeViewWrapper as="span" className="mention mention--user" data-testid="mention-user">
        @{stored}
      </NodeViewWrapper>
    );
  }

  const icon = pageQuery.data?.page.icon ?? "\u{1F4C4}";
  const title = pageQuery.data?.page.title || stored;

  return (
    <NodeViewWrapper as="span" className="mention mention--page" data-testid="mention-page">
      <button
        type="button"
        className="mention__btn"
        data-page-id={id}
        onClick={() => id && openPage(id)}
      >
        <span className="mention__icon" aria-hidden="true">
          {icon}
        </span>
        {title}
      </button>
    </NodeViewWrapper>
  );
}
