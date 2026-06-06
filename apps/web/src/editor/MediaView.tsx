import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useState } from "react";
import { isSafeUrl, safeUrl } from "@inclination/editor";

const UNSAFE_URL_MESSAGE = "Only http(s) URLs are allowed";

/**
 * React NodeView shared by the URL-based media blocks (file / video / bookmark /
 * embed). With no `src` it shows a URL input; once set it renders the
 * appropriate preview. Upload-from-disk is Phase 7 — Phase 4 takes a URL.
 *
 * Security: user-supplied URLs flow into `href`/`src`/`iframe src`, so an unsafe
 * scheme (`javascript:`, `data:text/html`, …) would be a stored XSS that syncs
 * to every collaborator via Yjs. We guard twice (defense in depth):
 *  - On COMMIT, an unsafe URL is rejected and never written to the doc/Yjs.
 *  - On RENDER, every URL is re-checked through {@link safeUrl}; an unsafe value
 *    (e.g. a pre-existing or synced bad value) renders as a neutral placeholder.
 */
export function MediaView({ node, updateAttributes, editor }: NodeViewProps): React.ReactElement {
  const type = node.type.name;
  const src = (node.attrs.src as string) ?? "";
  const title = (node.attrs.title as string) ?? "";
  const [draft, setDraft] = useState(src);
  const [error, setError] = useState<string | null>(null);

  const label =
    type === "videoBlock"
      ? "video"
      : type === "fileBlock"
        ? "file"
        : type === "bookmark"
          ? "bookmark"
          : "embed";

  if (!src) {
    return (
      <NodeViewWrapper className="media-block media-block--empty" data-testid={`media-${label}`}>
        <form
          className="media-form"
          onSubmit={(e) => {
            e.preventDefault();
            // Commit-time guard: never store an unsafe URL in the doc/Yjs.
            if (!isSafeUrl(draft)) {
              setError(UNSAFE_URL_MESSAGE);
              return;
            }
            setError(null);
            updateAttributes({ src: draft.trim() });
          }}
        >
          <input
            aria-label={`${label} URL`}
            placeholder={`Paste a ${label} URL…`}
            value={draft}
            disabled={!editor.isEditable}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
          />
          <button type="submit" disabled={!editor.isEditable || !draft}>
            Embed
          </button>
        </form>
        {error ? (
          <p className="media-form__error" role="alert" data-testid={`media-${label}-error`}>
            {error}
          </p>
        ) : null}
      </NodeViewWrapper>
    );
  }

  // Render-time guard: re-validate even committed values (a synced/pre-existing
  // doc could carry an unsafe URL that bypassed our commit guard).
  const safe = safeUrl(src);
  if (!safe) {
    return (
      <NodeViewWrapper className="media-block media-block--blocked" data-testid={`media-${label}`}>
        <p className="media-blocked" role="alert" data-testid={`media-${label}-blocked`}>
          🚫 Blocked URL ({UNSAFE_URL_MESSAGE.toLowerCase()})
        </p>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="media-block" data-testid={`media-${label}`}>
      {type === "videoBlock" ? (
        <video className="media-video" src={safe} controls />
      ) : type === "fileBlock" ? (
        <a className="media-file" href={safe} target="_blank" rel="noreferrer">
          📎 {title || safe}
        </a>
      ) : type === "bookmark" ? (
        <a className="media-bookmark" href={safe} target="_blank" rel="noreferrer">
          <span className="media-bookmark__title">{title || safe}</span>
          <span className="media-bookmark__url">{safe}</span>
        </a>
      ) : (
        <iframe className="media-embed" src={safe} title={title || "embed"} allowFullScreen />
      )}
    </NodeViewWrapper>
  );
}
