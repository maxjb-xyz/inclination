import { useCallback, useEffect, useMemo, useState } from "react";
import type { Page } from "../api/types";
import { Editor } from "./Editor";
import { BacklinksPanel } from "./BacklinksPanel";
import { useBacklinks, usePage, useUpdatePage } from "./queries";
import { useAuthStore } from "../auth/authStore";
import { useCollabSession } from "../collab/useCollabSession";
import { colorForUserId } from "../collab/color";
import { DatabaseView } from "../databases/DatabaseView";

export interface PageViewProps {
  workspaceId: string;
  pageId: string;
  onNavigate: (id: string) => void;
}

export function PageView({ workspaceId, pageId, onNavigate }: PageViewProps): React.ReactElement {
  const pageQuery = usePage(pageId);
  const updatePage = useUpdatePage(workspaceId);
  const backlinksQuery = useBacklinks(pageId);

  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.tokens?.accessToken ?? "");

  const page = pageQuery.data?.page;
  const breadcrumbs = pageQuery.data?.breadcrumbs ?? [];

  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("");
  const [cover, setCover] = useState("");

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

  // The body is collaborative: a fresh Yjs doc + provider per page (offline via
  // IndexedDB). Persistence is the sync server's job now — no REST body save.
  const { session, status, peers } = useCollabSession(pageId, accessToken);

  const collabUser = useMemo(
    () => ({
      name: user?.displayName ?? "Anonymous",
      color: colorForUserId(user?.id ?? ""),
    }),
    [user?.displayName, user?.id],
  );

  if (pageQuery.isLoading) {
    return <div className="page-view">Loading…</div>;
  }
  if (pageQuery.isError || !page) {
    return <div className="page-view">Could not load this page.</div>;
  }

  // A database page renders its collection UI in place of the collab body.
  if (page.type === "database") {
    return (
      <div className="page-view">
        <nav className="breadcrumbs" aria-label="Breadcrumbs">
          {breadcrumbs.map((b: Page) => (
            <button key={b.id} type="button" className="crumb" onClick={() => onNavigate(b.id)}>
              {b.icon ?? "\u{1F5C3}\u{FE0F}"} {b.title || "Untitled"}
            </button>
          ))}
          <span className="crumb current">
            {page.icon ?? "\u{1F5C3}\u{FE0F}"} {page.title || "Untitled"}
          </span>
        </nav>
        <header className="page-header">
          <input
            aria-label="Page title"
            className="title-input"
            placeholder="Untitled"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => commitMeta({ title })}
          />
        </header>
        <DatabaseView databaseId={page.id} workspaceId={workspaceId} />
      </div>
    );
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

      <div className="presence-indicator" role="status" data-testid="presence-indicator">
        <span className={`presence-dot presence-dot--${status}`} aria-hidden="true" />
        {status === "connected" ? "Connected" : status === "connecting" ? "Connecting…" : "Offline"}
        {peers > 0 ? ` · ${peers} other${peers === 1 ? "" : "s"} here` : ""}
      </div>

      {session ? (
        <Editor
          session={session}
          user={collabUser}
          workspaceId={workspaceId}
          onOpenPage={onNavigate}
        />
      ) : null}

      <BacklinksPanel
        backlinks={backlinksQuery.data ?? []}
        onOpenPage={onNavigate}
        loading={backlinksQuery.isLoading}
      />
    </div>
  );
}
