import { useCallback, useEffect, useState } from "react";
import type { Page } from "../api/types";
import { Editor } from "./Editor";
import { usePage, usePageContent, useUpdatePage } from "./queries";
import { createPagesApi } from "../api/pagesApi";
import { apiClient } from "../api/apiClient";

const api = createPagesApi(apiClient);

export interface PageViewProps {
  workspaceId: string;
  pageId: string;
  onNavigate: (id: string) => void;
}

export function PageView({ workspaceId, pageId, onNavigate }: PageViewProps): React.ReactElement {
  const pageQuery = usePage(pageId);
  const contentQuery = usePageContent(pageId);
  const updatePage = useUpdatePage(workspaceId);

  const page = pageQuery.data?.page;
  const breadcrumbs = pageQuery.data?.breadcrumbs ?? [];

  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("");
  const [cover, setCover] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  // Sync local edit fields when the loaded page changes.
  const pageKey = page ? `${page.id}:${page.title}:${page.icon}:${page.cover}` : null;
  useEffect(() => {
    if (page) {
      setTitle(page.title);
      setIcon(page.icon ?? "");
      setCover(page.cover ?? "");
    }
    // `page` is captured via pageKey to refresh only on identity/field change.
  }, [pageKey]);

  const commitMeta = useCallback(
    (patch: { title?: string; icon?: string | null; cover?: string | null }) => {
      updatePage.mutate({ id: pageId, input: patch });
    },
    [pageId, updatePage],
  );

  const handleSave = useCallback((doc: Record<string, unknown>, targetPageId: string) => {
    setSaveState("saving");
    // Persist to the page the edit was made in (targetPageId), NOT the page that
    // happens to be active now — a debounced save flushed during a page switch
    // must not write page A's content onto page B.
    api
      .saveContent(targetPageId, doc)
      .then(() => setSaveState("saved"))
      .catch(() => setSaveState("idle"));
  }, []);

  if (pageQuery.isLoading || contentQuery.isLoading) {
    return <div className="page-view">Loading…</div>;
  }
  if (pageQuery.isError || !page) {
    return <div className="page-view">Could not load this page.</div>;
  }

  return (
    <div className="page-view">
      <nav className="breadcrumbs" aria-label="Breadcrumbs">
        {breadcrumbs.map((b: Page) => (
          <button key={b.id} type="button" className="crumb" onClick={() => onNavigate(b.id)}>
            {b.icon ?? "\u{1F4C4}"} {b.title || "Untitled"}
          </button>
        ))}
        <span className="crumb current">
          {page.icon ?? "\u{1F4C4}"} {page.title || "Untitled"}
        </span>
      </nav>

      {cover ? <img className="page-cover" src={cover} alt="" /> : null}

      <header className="page-header">
        <input
          aria-label="Page icon"
          className="icon-input"
          placeholder="🙂"
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          onBlur={() => commitMeta({ icon: icon || null })}
        />
        <input
          aria-label="Page title"
          className="title-input"
          placeholder="Untitled"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => commitMeta({ title })}
        />
      </header>

      <div className="cover-edit">
        <input
          aria-label="Cover URL"
          placeholder="Cover image URL"
          value={cover}
          onChange={(e) => setCover(e.target.value)}
          onBlur={() => commitMeta({ cover: cover || null })}
        />
      </div>

      <div className="save-indicator" role="status">
        {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
      </div>

      <Editor
        pageId={pageId}
        initialDoc={(contentQuery.data?.doc ?? {}) as Record<string, unknown>}
        onSave={handleSave}
      />
    </div>
  );
}
