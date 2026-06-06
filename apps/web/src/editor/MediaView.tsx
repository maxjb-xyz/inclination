import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useState } from "react";

/**
 * React NodeView shared by the URL-based media blocks (file / video / bookmark /
 * embed). With no `src` it shows a URL input; once set it renders the
 * appropriate preview. Upload-from-disk is Phase 7 — Phase 4 takes a URL.
 */
export function MediaView({ node, updateAttributes, editor }: NodeViewProps): React.ReactElement {
  const type = node.type.name;
  const src = (node.attrs.src as string) ?? "";
  const title = (node.attrs.title as string) ?? "";
  const [draft, setDraft] = useState(src);

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
            updateAttributes({ src: draft });
          }}
        >
          <input
            aria-label={`${label} URL`}
            placeholder={`Paste a ${label} URL…`}
            value={draft}
            disabled={!editor.isEditable}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" disabled={!editor.isEditable || !draft}>
            Embed
          </button>
        </form>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="media-block" data-testid={`media-${label}`}>
      {type === "videoBlock" ? (
        <video className="media-video" src={src} controls />
      ) : type === "fileBlock" ? (
        <a className="media-file" href={src} target="_blank" rel="noreferrer">
          📎 {title || src}
        </a>
      ) : type === "bookmark" ? (
        <a className="media-bookmark" href={src} target="_blank" rel="noreferrer">
          <span className="media-bookmark__title">{title || src}</span>
          <span className="media-bookmark__url">{src}</span>
        </a>
      ) : (
        <iframe className="media-embed" src={src} title={title || "embed"} allowFullScreen />
      )}
    </NodeViewWrapper>
  );
}
