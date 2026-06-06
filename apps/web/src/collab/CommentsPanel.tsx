import { useState } from "react";
import { useAuthStore } from "../auth/authStore";
import type { CommentWithAuthor } from "../api/collabTypes";
import {
  useComments,
  useCreateComment,
  useDeleteComment,
  useResolveThread,
} from "./collabQueries";
import { groupThreads, renderCommentText, type CommentThread } from "./commentThreads";
import { CommentComposer } from "./CommentComposer";

export interface CommentsPanelProps {
  pageId: string;
  workspaceId: string;
  /** Whether the current user may post/resolve (canComment). */
  canComment: boolean;
  /** Whether the current user may moderate (delete others' comments) — canWrite. */
  canWrite: boolean;
  onClose: () => void;
  /** Optional highlight: open with this thread expanded (inline-anchor click). */
  focusThreadId?: string | null;
}

/**
 * Comments panel (spec §6): lists threads grouped by `threadId`, each with its
 * replies, a reply composer, resolve/unresolve and delete. A top-level composer
 * starts a new page-level thread. Inline-anchored threads show an "Inline"
 * badge. All mutations are gated on the supplied capabilities.
 */
export function CommentsPanel({
  pageId,
  workspaceId,
  canComment,
  canWrite,
  onClose,
  focusThreadId,
}: CommentsPanelProps): React.ReactElement {
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const comments = useComments(pageId);
  const createComment = useCreateComment(pageId);
  const resolveThread = useResolveThread(pageId);
  const deleteComment = useDeleteComment(pageId);
  const [replyTo, setReplyTo] = useState<string | null>(null);

  const threads = groupThreads(comments.data ?? []);

  const canDelete = (c: CommentWithAuthor): boolean => c.authorId === userId || canWrite;

  return (
    <aside className="comments-panel" data-testid="comments-panel" aria-label="Comments">
      <header className="comments-panel__header">
        <h2>Comments</h2>
        <button type="button" aria-label="Close comments" onClick={onClose}>
          ✕
        </button>
      </header>

      {canComment ? (
        <div className="comments-panel__new">
          <CommentComposer
            workspaceId={workspaceId}
            pending={createComment.isPending}
            onSubmit={(body) => createComment.mutate({ body })}
          />
        </div>
      ) : (
        <p className="comments-readonly">You can view comments but not post.</p>
      )}

      <div className="comments-panel__threads">
        {comments.isLoading ? <p>Loading…</p> : null}
        {threads.length === 0 && !comments.isLoading ? (
          <p className="comments-empty">No comments yet.</p>
        ) : null}
        {threads.map((thread) => (
          <ThreadView
            key={thread.threadId}
            thread={thread}
            defaultOpenReply={focusThreadId === thread.threadId}
            canComment={canComment}
            canDelete={canDelete}
            workspaceId={workspaceId}
            onReply={(body) =>
              createComment.mutate({ body, parentCommentId: thread.root.id })
            }
            onToggleResolve={() =>
              resolveThread.mutate({ commentId: thread.root.id, resolved: thread.resolved })
            }
            onDelete={(id) => deleteComment.mutate(id)}
            replyOpen={replyTo === thread.threadId}
            setReplyOpen={(open) => setReplyTo(open ? thread.threadId : null)}
          />
        ))}
      </div>
    </aside>
  );
}

interface ThreadViewProps {
  thread: CommentThread;
  workspaceId: string;
  canComment: boolean;
  canDelete: (c: CommentWithAuthor) => boolean;
  defaultOpenReply: boolean;
  onReply: (body: Record<string, unknown>) => void;
  onToggleResolve: () => void;
  onDelete: (id: string) => void;
  replyOpen: boolean;
  setReplyOpen: (open: boolean) => void;
}

function ThreadView({
  thread,
  workspaceId,
  canComment,
  canDelete,
  onReply,
  onToggleResolve,
  onDelete,
  replyOpen,
  setReplyOpen,
}: ThreadViewProps): React.ReactElement {
  return (
    <div
      className={`comment-thread${thread.resolved ? " is-resolved" : ""}`}
      data-testid="comment-thread"
      data-thread-id={thread.threadId}
    >
      {thread.anchor ? <span className="comment-thread__anchor">Inline</span> : null}
      {thread.comments.map((c) => (
        <div className="comment" data-testid="comment" key={c.id}>
          <div className="comment__meta">
            <span className="comment__author">{c.author?.displayName ?? "Someone"}</span>
            {canDelete(c) ? (
              <button
                type="button"
                aria-label="Delete comment"
                className="comment__delete"
                onClick={() => onDelete(c.id)}
              >
                Delete
              </button>
            ) : null}
          </div>
          <div className="comment__body">{renderCommentText(c.body)}</div>
        </div>
      ))}

      <div className="comment-thread__actions">
        {canComment ? (
          <>
            <button type="button" onClick={() => setReplyOpen(!replyOpen)}>
              {replyOpen ? "Cancel" : "Reply"}
            </button>
            <button type="button" onClick={onToggleResolve}>
              {thread.resolved ? "Unresolve" : "Resolve"}
            </button>
          </>
        ) : null}
      </div>

      {replyOpen && canComment ? (
        <CommentComposer
          workspaceId={workspaceId}
          placeholder="Reply…"
          submitLabel="Reply"
          onSubmit={(body) => {
            onReply(body);
            setReplyOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
