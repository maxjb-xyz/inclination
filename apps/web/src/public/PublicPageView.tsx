import { useEffect, useMemo, useState } from "react";
import { fetchPublicPage } from "../api/publishingApi";
import type { PublicPage } from "../api/types";
import { sanitizeHtml } from "./sanitizeHtml";

export interface PublicPageViewProps {
  slug: string;
  /** Injected for tests; defaults to the real unauthenticated fetch. */
  fetcher?: (slug: string) => Promise<PublicPage>;
}

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "loaded"; page: PublicPage };

/**
 * The logged-out public page (spec §8). Rendered by the app shell BEFORE the
 * auth gate, so it never requires a token. Fetches `GET /api/public/:slug` (no
 * auth), SANITIZES the returned HTML, and renders it read-only. If the share
 * includes subpages, their links are listed.
 */
export function PublicPageView({ slug, fetcher }: PublicPageViewProps): React.ReactElement {
  const load = fetcher ?? fetchPublicPage;
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    load(slug)
      .then((page) => {
        if (!cancelled) setState({ kind: "loaded", page });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
    // `load` is stable for a given mount; re-run only when the slug changes.
  }, [slug]);

  const safeHtml = useMemo(
    () => (state.kind === "loaded" ? sanitizeHtml(state.page.html) : ""),
    [state],
  );

  if (state.kind === "loading") {
    return (
      <main className="public-page" data-testid="public-page">
        <p>Loading…</p>
      </main>
    );
  }
  if (state.kind === "error") {
    return (
      <main className="public-page" data-testid="public-page">
        <h1>Page not found</h1>
        <p>This page is not published, or the link is incorrect.</p>
      </main>
    );
  }

  const { page } = state;
  return (
    <main className="public-page" data-testid="public-page">
      <article className="public-page__article">
        <h1 className="public-page__title" data-testid="public-title">
          {page.title || "Untitled"}
        </h1>
        {/* Sanitized above — safe to inject. */}
        <div
          className="public-page__body"
          data-testid="public-body"
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
        {page.subpages && page.subpages.length > 0 ? (
          <nav className="public-page__subpages" aria-label="Subpages" data-testid="public-subpages">
            <h2>Subpages</h2>
            <ul>
              {page.subpages.map((sp) => (
                <li key={sp.slug}>
                  <a href={`/public/${sp.slug}`}>{sp.title || "Untitled"}</a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </article>
    </main>
  );
}
