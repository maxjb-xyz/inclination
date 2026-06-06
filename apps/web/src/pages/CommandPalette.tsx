import { useEffect, useMemo, useRef, useState } from "react";
import { useSearch } from "./queries";
import { debounce } from "./debounce";
import { parseSnippet } from "./snippet";

export interface CommandPaletteProps {
  workspaceId: string;
  onClose: () => void;
  onOpenPage: (pageId: string) => void;
  onNewPage: () => void;
  onOpenTrash: () => void;
}

/** A quick action shown above (empty query) / below search results. */
interface QuickAction {
  id: string;
  label: string;
  run: () => void;
}

const SEARCH_DEBOUNCE_MS = 250;

/**
 * ⌘K command palette / quick switcher. Debounced full-text search over the
 * workspace plus quick actions (New page, Open Trash). Arrow keys move the
 * active item; Enter activates it; Escape closes. Mounted at the app shell so
 * it is reachable from any page.
 */
export function CommandPalette({
  workspaceId,
  onClose,
  onOpenPage,
  onNewPage,
  onOpenTrash,
}: CommandPaletteProps): React.ReactElement {
  const [raw, setRaw] = useState("");
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce the value that drives the query so each keystroke doesn't fetch.
  const debounced = useMemo(() => debounce((v: string) => setQuery(v), SEARCH_DEBOUNCE_MS), []);
  useEffect(() => () => debounced.cancel(), [debounced]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const searchQuery = useSearch(workspaceId, query);
  const results = searchQuery.data ?? [];

  const actions: QuickAction[] = useMemo(
    () => [
      { id: "new-page", label: "＋ New page", run: () => withClose(onNewPage) },
      { id: "open-trash", label: "🗑 Open Trash", run: () => withClose(onOpenTrash) },
    ],
    [onNewPage, onOpenTrash],
  );

  function withClose(fn: () => void): void {
    fn();
    onClose();
  }

  // Flatten the navigable items (results first, then actions) for keyboard nav.
  const items = useMemo(
    () => [
      ...results.map((r) => ({ kind: "page" as const, id: r.pageId, run: () => withClose(() => onOpenPage(r.pageId)) })),
      ...actions.map((a) => ({ kind: "action" as const, id: a.id, run: a.run })),
    ],
    [results, actions, onOpenPage],
  );

  const [active, setActive] = useState(0);
  useEffect(() => {
    // Keep the active index in range as the item list changes.
    setActive((i) => (items.length === 0 ? 0 : Math.min(i, items.length - 1)));
  }, [items.length]);

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (items.length === 0 ? 0 : (i - 1 + items.length) % items.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[active]?.run();
    }
  }

  return (
    <div
      className="command-palette__overlay"
      data-testid="command-palette"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="command-palette" onKeyDown={onKeyDown}>
        <input
          ref={inputRef}
          className="command-palette__input"
          data-testid="command-palette-input"
          aria-label="Search pages and actions"
          placeholder="Search pages or jump to…"
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            debounced(e.target.value);
          }}
        />

        <ul className="command-palette__list" role="listbox">
          {query.trim() && searchQuery.isFetching && results.length === 0 ? (
            <li className="command-palette__hint" data-testid="command-palette-loading">
              Searching…
            </li>
          ) : null}

          {results.map((r, idx) => (
            <li
              key={r.pageId}
              role="option"
              aria-selected={active === idx}
              className={`command-palette__result${active === idx ? " is-active" : ""}`}
              data-testid="command-palette-result"
              onMouseEnter={() => setActive(idx)}
              onMouseDown={(e) => {
                e.preventDefault();
                withClose(() => onOpenPage(r.pageId));
              }}
            >
              <span className="command-palette__result-title">{r.title || "Untitled"}</span>
              <span className="command-palette__result-snippet" data-testid="command-palette-snippet">
                {parseSnippet(r.snippet).map((part, i) =>
                  part.highlight ? (
                    <mark key={i} data-testid="snippet-highlight">
                      {part.text}
                    </mark>
                  ) : (
                    <span key={i}>{part.text}</span>
                  ),
                )}
              </span>
            </li>
          ))}

          {query.trim() && !searchQuery.isFetching && results.length === 0 ? (
            <li className="command-palette__hint" data-testid="command-palette-empty">
              No pages found
            </li>
          ) : null}

          {actions.map((a, i) => {
            const idx = results.length + i;
            return (
              <li
                key={a.id}
                role="option"
                aria-selected={active === idx}
                className={`command-palette__action${active === idx ? " is-active" : ""}`}
                data-testid={`command-palette-action-${a.id}`}
                onMouseEnter={() => setActive(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  a.run();
                }}
              >
                {a.label}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
