import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useState } from "react";
import { isSafeUrl, safeUrl } from "@inclination/editor";
import { useUploadEditorContext } from "./uploadContext";
import { useAttachmentUpload, useResolvedAttachmentUrl } from "./useAttachmentUpload";

const UNSAFE_URL_MESSAGE = "Only http(s) URLs are allowed";

/**
 * React NodeView for the `image` node. With no `src`/`attachmentId` it offers
 * EITHER a URL embed (existing http(s) path, guarded by {@link isSafeUrl}) OR a
 * file upload (presign → PUT → store `attachmentId`). An uploaded image stores
 * its `attachmentId` on the node and resolves a fresh presigned URL on load, so
 * it survives reload. A typed URL is stored verbatim and re-checked on render.
 */
export function ImageView({ node, updateAttributes, editor }: NodeViewProps): React.ReactElement {
  const src = (node.attrs.src as string) ?? "";
  const attachmentId = (node.attrs.attachmentId as string | null) ?? null;
  const alt = (node.attrs.alt as string) ?? "";
  const [draft, setDraft] = useState(src);
  const [error, setError] = useState<string | null>(null);

  const ctx = useUploadEditorContext();
  const { status, error: uploadError, upload } = useAttachmentUpload();
  const resolved = useResolvedAttachmentUrl(attachmentId);

  async function onPickFile(file: File): Promise<void> {
    if (!ctx) {
      setError("Upload unavailable here");
      return;
    }
    setError(null);
    const ref = await upload(ctx.workspaceId, file, ctx.pageId);
    if (ref) {
      // Store the attachment id (+ a fallback served path); clear any typed src
      // so render resolves a fresh presigned URL from the id.
      updateAttributes({ attachmentId: ref.attachmentId, src: ref.downloadPath, alt: file.name });
    }
  }

  // ── Empty: offer URL embed + upload ──────────────────────────
  if (!src && !attachmentId) {
    return (
      <NodeViewWrapper className="media-block media-block--empty" data-testid="media-image">
        <form
          className="media-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!isSafeUrl(draft)) {
              setError(UNSAFE_URL_MESSAGE);
              return;
            }
            setError(null);
            updateAttributes({ src: draft.trim(), attachmentId: null });
          }}
        >
          <input
            aria-label="image URL"
            placeholder="Paste an image URL…"
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
        <label className="media-upload">
          <span>or upload</span>
          <input
            type="file"
            accept="image/*"
            aria-label="upload image"
            data-testid="media-image-upload"
            disabled={!editor.isEditable || status === "uploading"}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onPickFile(file);
            }}
          />
        </label>
        {status === "uploading" ? (
          <p className="media-form__progress" data-testid="media-image-uploading">
            Uploading…
          </p>
        ) : null}
        {error || uploadError ? (
          <p className="media-form__error" role="alert" data-testid="media-image-error">
            {error ?? uploadError}
          </p>
        ) : null}
      </NodeViewWrapper>
    );
  }

  // ── Uploaded: render via the freshly-resolved presigned URL ──
  if (attachmentId) {
    if (resolved.error) {
      return (
        <NodeViewWrapper className="media-block media-block--blocked" data-testid="media-image">
          <p className="media-blocked" role="alert" data-testid="media-image-blocked">
            🚫 Attachment unavailable
          </p>
        </NodeViewWrapper>
      );
    }
    if (!resolved.url) {
      return (
        <NodeViewWrapper className="media-block" data-testid="media-image">
          <p className="media-form__progress">Loading…</p>
        </NodeViewWrapper>
      );
    }
    return (
      <NodeViewWrapper className="media-block" data-testid="media-image">
        <img className="media-image" src={resolved.url} alt={alt} />
      </NodeViewWrapper>
    );
  }

  // ── URL-embedded: re-validate the stored URL on render ───────
  const safe = safeUrl(src);
  if (!safe) {
    return (
      <NodeViewWrapper className="media-block media-block--blocked" data-testid="media-image">
        <p className="media-blocked" role="alert" data-testid="media-image-blocked">
          🚫 Blocked URL ({UNSAFE_URL_MESSAGE.toLowerCase()})
        </p>
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper className="media-block" data-testid="media-image">
      <img className="media-image" src={safe} alt={alt} />
    </NodeViewWrapper>
  );
}
