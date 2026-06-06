import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { usePage } from "../pages/queries";
import { useOpenPage } from "./openPageContext";

/**
 * NodeView for the inline `pageLink` node. Shows the target page's live title
 * (falling back to the stored label) and navigates to it on click via the
 * shared open-page handler. The stored `label` keeps the doc self-describing for
 * collaborators / reloads even before the query resolves.
 */
export function PageLinkView({ node }: NodeViewProps): React.ReactElement {
  const pageId = (node.attrs.pageId as string) ?? "";
  const stored = (node.attrs.label as string) || "Untitled";
  const openPage = useOpenPage();

  const pageQuery = usePage(pageId || null);
  const icon = pageQuery.data?.page.icon ?? "\u{1F517}";
  const title = pageQuery.data?.page.title || stored;

  return (
    <NodeViewWrapper as="span" className="page-link" data-testid="page-link">
      <button
        type="button"
        className="page-link__btn"
        data-page-id={pageId}
        onClick={() => pageId && openPage(pageId)}
      >
        <span className="page-link__icon" aria-hidden="true">
          {icon}
        </span>
        {title}
      </button>
    </NodeViewWrapper>
  );
}
