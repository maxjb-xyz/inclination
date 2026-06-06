import { createContext, useContext } from "react";

/**
 * Context for media NodeViews (image / file / video) that support upload: they
 * need the active workspace id (to scope the presign) and the page id (to
 * associate the {@link Attachment} with the page). Provided by the Editor.
 */
export interface UploadEditorContextValue {
  workspaceId: string;
  pageId: string;
}

export const UploadEditorContext = createContext<UploadEditorContextValue | null>(null);

export function useUploadEditorContext(): UploadEditorContextValue | null {
  return useContext(UploadEditorContext);
}
