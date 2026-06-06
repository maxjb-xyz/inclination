import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { Page } from "../api/types";
import type { BlockAnchor } from "@inclination/shared";
import { Editor, type InlineCommentAnchor } from "./Editor";
import { PublishDialog } from "../publish/PublishDialog";
import { apiClient } from "../api/apiClient";
import { createPublishingApi } from "../api/publishingApi";
import { downloadMarkdown } from "../publish/download";
import { BacklinksPanel } from "./BacklinksPanel";
import { VersionHistoryPanel } from "./VersionHistoryPanel";
import { useBacklinks, usePage, useUpdatePage } from "./queries";
import { useAuthStore } from "../auth/authStore";
import { useCollabSession } from "../collab/useCollabSession";
import { colorForUserId } from "../collab/color";
import { DatabaseView } from "../databases/DatabaseView";
import { usePageAccess, useCreateComment } from "../collab/collabQueries";
import { ShareDialog } from "../collab/ShareDialog";
import { CommentsPanel } from "../collab/CommentsPanel";
import { CommentComposer } from "../collab/CommentComposer";

const publishingApi = createPublishingApi(apiClient);

export interface PageViewProps {
  workspaceId: string;
  pageId: string;
  onNavigate: (id: string) => void;
}

export function PageView({ workspaceId, pageId, onNavigate }: PageViewProps): React.ReactElement {
  const pageQuery = usePage(pageId);
  const updatePage = useUpdatePage(workspaceId);
  const backlinksQuery = useBacklinks(pageId);
  const accessQuery = usePageAccess(pageId);
  const createComment = useCreateComment(pageId);

  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.tokens?.accessToken ?? "");

  const page = pageQuery.data?.page;
  const breadcrumbs = pageQuery.data?.breadcrumbs ?? [];

  // Capabilities (default to read-only until access resolves so we never flash
  // edit affordances to a viewer).
  const access = accessQuery.data;
  const canWrite = access?.canWrite ?? false;
  const canComment = access?.canComment ?? false;
  const canShare = access?.canShare ?? false;

  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("");
  const [cover, setCover] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // The live editor instance, captured for HTML serialization on publish.
  const editorRef = useRef<TiptapEditor | null>(null);
  const [focusThreadId, setFocusThreadId] = useState<string | null>(null);
  // A pending inline-anchor: when set, an anchored composer is shown.
  const [pendingAnchor, setPendingAnchor] = useState<InlineCommentAnchor | null>(null);

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
      if (!canWrite) return;
      updatePage.mutate({ id: pageId, input: patch });
    },
    [pageId, updatePage, canWrite],
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

  const onCommentOnSelection = useCallback((anchor: InlineCommentAnchor) => {
    setPendingAnchor(anchor);
    setCommentsOpen(true);
  }, []);

  const getHtml = useCallback((): string => editorRef.current?.getHTML() ?? "", []);

  const handleEditorReady = useCallback((e: TiptapEditor | null) => {
    editorRef.current = e;
  }, []);

  const onExport = useCallback(async () => {
    const { filename, markdown } = await publishingApi.exportMarkdown(pageId);
    downloadMarkdown(filename, markdown);
  }, [pageId]);

  if (pageQuery.isLoading) {
    return <div className="page-view">Loading…</div>;
  }
  if (pageQuery.isError || !page) {
    return <div className="page-view">Could not load this page.</div>;
  }

  const headerActions = (
    <div className="page-actions" data-testid="page-actions">
      <button
        type="button"
        className="page-action"
        data-testid="toggle-comments"
        onClick={() => setCommentsOpen((o) => !o)}
      >
        💬 Comments
      </button>
      <button
        type="button"
        className="page-action"
        data-testid="toggle-history"
        onClick={() => setHistoryOpen((o) => !o)}
      >
        🕑 History
      </button>
      <button
        type="button"
        className="page-action"
        data-testid="export-markdown"
        onClick={() => void onExport()}
      >
        ⬇ Export
      </button>
      {canShare ? (
        <button
          type="button"
          className="page-action"
          data-testid="open-publish"
          onClick={() => setPublishOpen(true)}
        >
          🌐 Publish
        </button>
      ) : null}
      {canShare ? (
        <button
          type="button"
          className="page-action"
          data-testid="open-share"
          onClick={() => setShareOpen(true)}
        >
          Share
        </button>
      ) : null}
    </div>
  );

  const publishDialog =
    publishOpen && canShare ? (
      <PublishDialog
        pageId={pageId}
        title={title}
        getHtml={getHtml}
        onClose={() => setPublishOpen(false)}
      />
    ) : null;

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
            disabled={!canWrite}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => commitMeta({ title })}
          />
          {headerActions}
        </header>
        <DatabaseView databaseId={page.id} workspaceId={workspaceId} />
        {historyOpen ? (
          <VersionHistoryPanel
            pageId={pageId}
            canWrite={canWrite}
            onClose={() => setHistoryOpen(false)}
          />
        ) : null}
        {shareOpen ? (
          <ShareDialog pageId={pageId} workspaceId={workspaceId} onClose={() => setShareOpen(false)} />
        ) : null}
        {publishDialog}
        {commentsOpen ? (
          <CommentsPanel
            pageId={pageId}
            workspaceId={workspaceId}
            canComment={canComment}
            canWrite={canWrite}
            focusThreadId={focusThreadId}
            onClose={() => setCommentsOpen(false)}
          />
        ) : null}
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
          disabled={!canWrite}
          onChange={(e) => setIcon(e.target.value)}
          onBlur={() => commitMeta({ icon: icon || null })}
        />
        <input
          aria-label="Page title"
          className="title-input"
          placeholder="Untitled"
          value={title}
          disabled={!canWrite}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => commitMeta({ title })}
        />
        {headerActions}
      </header>

      {canWrite ? (
        <div className="cover-edit">
          <input
            aria-label="Cover URL"
            placeholder="Cover image URL"
            value={cover}
            onChange={(e) => setCover(e.target.value)}
            onBlur={() => commitMeta({ cover: cover || null })}
          />
        </div>
      ) : null}

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
          editable={canWrite}
          onCommentOnSelection={canComment ? onCommentOnSelection : undefined}
          token={accessToken}
          onEditorReady={handleEditorReady}
        />
      ) : null}

      <BacklinksPanel
        backlinks={backlinksQuery.data ?? []}
        onOpenPage={onNavigate}
        loading={backlinksQuery.isLoading}
      />

      {historyOpen ? (
        <VersionHistoryPanel
          pageId={pageId}
          canWrite={canWrite}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}

      {shareOpen ? (
        <ShareDialog pageId={pageId} workspaceId={workspaceId} onClose={() => setShareOpen(false)} />
      ) : null}

      {publishDialog}

      {commentsOpen ? (
        <CommentsPanel
          pageId={pageId}
          workspaceId={workspaceId}
          canComment={canComment}
          canWrite={canWrite}
          focusThreadId={focusThreadId}
          onClose={() => {
            setCommentsOpen(false);
            setPendingAnchor(null);
          }}
        />
      ) : null}

      {pendingAnchor && canComment ? (
        <div className="inline-comment-composer" data-testid="inline-comment-composer">
          <p className="inline-comment-composer__quote">“{pendingAnchor.text}”</p>
          <CommentComposer
            workspaceId={workspaceId}
            placeholder="Comment on selection…"
            submitLabel="Add inline comment"
            onSubmit={(body) => {
              const anchor: BlockAnchor = {
                blockId: pendingAnchor.blockId,
                from: pendingAnchor.from,
                to: pendingAnchor.to,
              };
              createComment.mutate(
                { body, blockAnchor: anchor },
                {
                  onSuccess: (c) => {
                    setFocusThreadId(c.threadId);
                    setPendingAnchor(null);
                  },
                },
              );
            }}
          />
          <button type="button" onClick={() => setPendingAnchor(null)}>
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}
