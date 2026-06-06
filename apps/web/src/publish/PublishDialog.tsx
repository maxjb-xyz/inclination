import { useEffect, useState } from "react";
import { slugSchema } from "@inclination/shared";
import { usePublicShare, usePublishPage, useUnpublishPage } from "./publishQueries";

export interface PublishDialogProps {
  pageId: string;
  /** The page title at publish time (stored on the share for the public view). */
  title: string;
  /** Serialize the current editor doc to HTML (`editor.getHTML()`). */
  getHtml: () => string;
  onClose: () => void;
}

/** Build the public URL for a slug against the current origin. */
export function publicUrlFor(slug: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/public/${slug}`;
}

/**
 * Publish dialog (spec §8) — mounted only for a `canShare` user from the page
 * header. Shows the current publish state (`GET /pages/:id/public-share`), lets
 * the user pick include-subpages / allow-duplicate toggles + an optional slug,
 * and publishes by serializing the live editor doc to HTML and POSTing it. Once
 * published it shows the copyable public URL and an Unpublish action.
 */
export function PublishDialog({
  pageId,
  title,
  getHtml,
  onClose,
}: PublishDialogProps): React.ReactElement {
  const shareQuery = usePublicShare(pageId);
  const publish = usePublishPage(pageId);
  const unpublish = useUnpublishPage(pageId);

  const share = shareQuery.data ?? null;
  const published = Boolean(share?.published);

  const [slug, setSlug] = useState("");
  const [includeSubpages, setIncludeSubpages] = useState(false);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Seed the form from the loaded settings once (and on identity change).
  const seedKey = share ? `${share.slug}:${share.includeSubpages}:${share.allowDuplicate}` : null;
  useEffect(() => {
    if (share) {
      setSlug(share.slug);
      setIncludeSubpages(share.includeSubpages);
      setAllowDuplicate(share.allowDuplicate);
    }
  }, [seedKey]);

  const publicUrl = share && published ? publicUrlFor(share.slug) : null;

  function doPublish(): void {
    setSlugError(null);
    const trimmed = (slug ?? "").trim();
    if (trimmed) {
      const parsed = slugSchema.safeParse(trimmed);
      if (!parsed.success) {
        setSlugError("Slug must be lowercase words separated by hyphens.");
        return;
      }
    }
    publish.mutate({
      ...(trimmed ? { slug: trimmed } : {}),
      includeSubpages,
      allowDuplicate,
      html: getHtml(),
      title,
    });
  }

  async function copyUrl(): Promise<void> {
    if (!publicUrl) return;
    try {
      await navigator.clipboard?.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable (no permission / insecure context) — the
      // URL is still visible for manual copy, so we swallow the failure.
    }
  }

  return (
    <div
      className="publish-dialog-backdrop"
      role="dialog"
      aria-label="Publish page"
      data-testid="publish-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="publish-dialog">
        <header className="publish-dialog__header">
          <h2>Publish to web</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        <p className="publish-dialog__state" data-testid="publish-state">
          {shareQuery.isLoading
            ? "Loading…"
            : published
              ? "This page is live on the web."
              : "This page is private."}
        </p>

        <label className="publish-field">
          <span>Slug (optional)</span>
          <input
            aria-label="Slug"
            placeholder="auto-from-title"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
        </label>
        {slugError ? (
          <p className="publish-err" role="alert">
            {slugError}
          </p>
        ) : null}

        <label className="publish-toggle">
          <input
            type="checkbox"
            aria-label="Include subpages"
            checked={includeSubpages}
            onChange={(e) => setIncludeSubpages(e.target.checked)}
          />
          <span>Include published subpages</span>
        </label>
        <label className="publish-toggle">
          <input
            type="checkbox"
            aria-label="Allow duplicate"
            checked={allowDuplicate}
            onChange={(e) => setAllowDuplicate(e.target.checked)}
          />
          <span>Allow readers to duplicate</span>
        </label>

        {publicUrl ? (
          <div className="publish-url" data-testid="public-url">
            <input aria-label="Public URL" readOnly value={publicUrl} />
            <button type="button" onClick={copyUrl} data-testid="copy-public-url">
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        ) : null}

        <div className="publish-actions">
          <button
            type="button"
            data-testid="publish-button"
            disabled={publish.isPending}
            onClick={doPublish}
          >
            {publish.isPending ? "Publishing…" : published ? "Re-publish" : "Publish"}
          </button>
          {published ? (
            <button
              type="button"
              data-testid="unpublish-button"
              disabled={unpublish.isPending}
              onClick={() => unpublish.mutate()}
            >
              {unpublish.isPending ? "Unpublishing…" : "Unpublish"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
