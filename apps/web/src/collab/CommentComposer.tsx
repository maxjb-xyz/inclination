import { useRef, useState } from "react";
import type { MentionableUser } from "../api/types";
import { apiClient } from "../api/apiClient";
import { createPagesApi } from "../api/pagesApi";
import { buildCommentBody, type CommentToken } from "./commentThreads";

const pagesApi = createPagesApi(apiClient);

export interface CommentComposerProps {
  workspaceId: string;
  placeholder?: string;
  submitLabel?: string;
  pending?: boolean;
  /** Called with the assembled rich-text body when the user submits. */
  onSubmit: (body: Record<string, unknown>) => void;
}

/**
 * Comment composer with `@`-mention autocomplete (spec §6). Plain text plus
 * inline user mentions: typing `@query` opens a member picker (reusing the
 * `searchMentionable` API the editor uses); selecting a user inserts a mention
 * token. On submit it assembles a ProseMirror-shaped body via
 * {@link buildCommentBody} so the API can extract mentions → notifications.
 *
 * The composer keeps an ordered token list (text + mention) rather than driving
 * a full ProseMirror instance, which keeps it light and unit-testable while
 * still emitting the body shape the API expects.
 */
export function CommentComposer({
  workspaceId,
  placeholder = "Add a comment…",
  submitLabel = "Comment",
  pending = false,
  onSubmit,
}: CommentComposerProps): React.ReactElement {
  const [tokens, setTokens] = useState<CommentToken[]>([]);
  const [draft, setDraft] = useState("");
  const [results, setResults] = useState<MentionableUser[]>([]);
  const [open, setOpen] = useState(false);
  const reqId = useRef(0);

  const mentionMatch = /@([\w.@-]*)$/.exec(draft);

  function onChange(value: string): void {
    setDraft(value);
    const m = /@([\w.@-]*)$/.exec(value);
    if (m) {
      setOpen(true);
      const id = ++reqId.current;
      void pagesApi.searchMentionable(workspaceId, m[1] ?? "").then((res) => {
        if (id === reqId.current) setResults(res.users);
      });
    } else {
      setOpen(false);
      setResults([]);
    }
  }

  function pickMention(user: MentionableUser): void {
    const text = mentionMatch ? draft.slice(0, draft.length - mentionMatch[0].length) : draft;
    const next: CommentToken[] = [];
    if (text) next.push({ type: "text", text });
    next.push({ type: "mention", id: user.id, label: user.displayName });
    next.push({ type: "text", text: " " });
    setTokens((prev) => [...prev, ...next]);
    setDraft("");
    setOpen(false);
    setResults([]);
  }

  function submit(): void {
    const finalTokens: CommentToken[] = [...tokens];
    if (draft.trim()) finalTokens.push({ type: "text", text: draft });
    const hasContent = finalTokens.some((t) =>
      t.type === "mention" ? true : t.text.trim().length > 0,
    );
    if (!hasContent) return;
    onSubmit(buildCommentBody(finalTokens));
    setTokens([]);
    setDraft("");
    setOpen(false);
  }

  return (
    <div className="comment-composer" data-testid="comment-composer">
      {tokens.length > 0 ? (
        <div className="comment-composer__tokens" aria-hidden="true">
          {tokens.map((t, i) =>
            t.type === "mention" ? (
              <span key={i} className="comment-mention-chip">
                @{t.label}
              </span>
            ) : (
              <span key={i}>{t.text}</span>
            ),
          )}
        </div>
      ) : null}
      <textarea
        aria-label="Comment text"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {open && results.length > 0 ? (
        <div className="comment-mention-menu" role="listbox" data-testid="comment-mention-menu">
          {results.map((u) => (
            <button
              key={u.id}
              type="button"
              role="option"
              aria-selected={false}
              className="comment-mention-menu__item"
              onMouseDown={(e) => {
                e.preventDefault();
                pickMention(u);
              }}
            >
              <span className="comment-mention-menu__label">{u.displayName}</span>
              <span className="comment-mention-menu__hint">{u.email}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="comment-composer__actions">
        <button type="button" onClick={submit} disabled={pending}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
