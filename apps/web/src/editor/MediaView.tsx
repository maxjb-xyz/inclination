import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useState } from "react";
import { isSafeUrl, safeUrl } from "@inclination/editor";
import { useUploadEditorContext } from "./uploadContext";
import { useAttachmentUpload, useResolvedAttachmentUrl } from "./useAttachmentUpload";

const UNSAFE_URL_MESSAGE = "Only http(s) URLs are allowed";

/**
 * React NodeView shared by the URL-based media blocks (file / video / bookmark /
 * embed). With no `src`/`attachmentId` it shows EITHER a URL input (existing) OR
 * — for file/video — a file upload (presign → PUT → store `attachmentId`); once
 * set it renders the appropriate preview.
 *
 * Upload survives reload: file/video uploads store the `attachmentId` on the
 * node and resolve a fresh presigned URL on load (presigned GETs expire), with
 * `downloadPath` kept as a `src` fallback.
 *
 * Security: user-supplied URLs flow into `href`/`src`/`iframe src`, so an unsafe
 * scheme (`javascript:`, `data:text/html`, …) would be a stored XSS that syncs
 * to every collaborator via Yjs. We guard twice (defense in depth):
 *  - On COMMIT, an unsafe URL is rejected and never written to the doc/Yjs.
 *  - On RENDER, every URL is re-checked through {@link safeUrl}; an unsafe value
 *    (e.g. a pre-existing or synced bad value) renders as a neutral placeholder.
 *  - Resolved attachment URLs come from our own API, but are still re-checked.
 */
export function MediaView({ node, updateAttributes, editor }: NodeViewProps): React.ReactElement {
  const type = node.type.name;
  const src = (node.attrs.src as string) ?? "";
  const title = (node.attrs.title as string) ?? "";
  const attachmentId = (node.attrs.attachmentId as string | null) ?? null;
  const [draft, setDraft] = useState(src);
  const [error, setError] = useState<string | null>(null);

  const ctx = useUploadEditorContext();
  const { status, error: uploadError, upload } = useAttachmentUpload();
  const resolved = useResolvedAttachmentUrl(attachmentId);

  const label =
    type === "videoBlock"
      ? "video"
      : type === "fileBlock"
        ? "file"
        : type === "bookmark"
          ? "bookmark"
          : "embed";
  // Only file/video blocks accept a binary upload; bookmark/embed are URL-only.
  const uploadable = type === "fileBlock" || type === "videoBlock";

  async function onPickFile(file: File): Promise<void> {
    if (!ctx) {
      setError("Upload unavailable here");
      return;
    }
    setError(null);
    const ref = await upload(ctx.workspaceId, file, ctx.pageId);
    if (ref) {
      updateAttributes({ attachmentId: ref.attachmentId, src: ref.downloadPath, title: file.name });
    }
  }

  // ── Empty: URL embed (+ upload for file/video) ───────────────
  if (!src && !attachmentId) {
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
            updateAttributes({ src: draft.trim(), attachmentId: null });
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
        {uploadable ? (
          <label className="media-upload">
            <span>or upload</span>
            <input
              type="file"
              aria-label={`upload ${label}`}
              data-testid={`media-${label}-upload`}
              disabled={!editor.isEditable || status === "uploading"}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onPickFile(file);
              }}
            />
          </label>
        ) : null}
        {status === "uploading" ? (
          <p className="media-form__progress" data-testid={`media-${label}-uploading`}>
            Uploading…
          </p>
        ) : null}
        {error || uploadError ? (
          <p className="media-form__error" role="alert" data-testid={`media-${label}-error`}>
            {error ?? uploadError}
          </p>
        ) : null}
      </NodeViewWrapper>
    );
  }

  // ── Uploaded: resolve a fresh served URL from the attachment id ──
  let resolvedSrc = src;
  if (attachmentId) {
    if (resolved.error) {
      return (
        <NodeViewWrapper className="media-block media-block--blocked" data-testid={`media-${label}`}>
          <p className="media-blocked" role="alert" data-testid={`media-${label}-blocked`}>
            🚫 Attachment unavailable
          </p>
        </NodeViewWrapper>
      );
    }
    if (!resolved.url) {
      return (
        <NodeViewWrapper className="media-block" data-testid={`media-${label}`}>
          <p className="media-form__progress">Loading…</p>
        </NodeViewWrapper>
      );
    }
    resolvedSrc = resolved.url;
  }

  // Render-time guard: re-validate every value (a synced/pre-existing doc could
  // carry an unsafe URL that bypassed our commit guard).
  const safe = safeUrl(resolvedSrc);
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
