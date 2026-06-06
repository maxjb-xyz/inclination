import { createContext, useContext } from "react";

/** Navigate to a page by id. Wired from Workspace's open-page mechanism. */
export type OpenPageHandler = (pageId: string) => void;

/**
 * Context carrying the "open a page" navigation handler down to editor
 * NodeViews (pageLink / page-mention), which are rendered by Tiptap's
 * ReactNodeViewRenderer outside the normal component tree but still inside the
 * provider mounted around `<EditorContent>`.
 */
export const OpenPageContext = createContext<OpenPageHandler | null>(null);

/** Hook for NodeViews to grab the navigation handler (no-op when unset). */
export function useOpenPage(): OpenPageHandler {
  const handler = useContext(OpenPageContext);
  return handler ?? (() => {});
}
