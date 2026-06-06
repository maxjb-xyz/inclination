import type { Editor, Range } from "@tiptap/core";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PagesApi } from "../api/pagesApi";
import type { MentionableResult } from "../api/types";
import { debounce } from "../pages/debounce";
import {
  MentionMenuList,
  type MentionCommandPayload,
  type MentionMenuItem,
  type MentionMenuListHandle,
} from "./MentionMenu";

/**
 * Map a mentionable search result to `@`-mention menu items: workspace members
 * (inserted as a `user` mention) followed by pages (inserted as a `page`
 * mention). User mentions render the display name; page mentions point at the
 * page and feed the backlink extractor.
 */
export function mapMentionableToItems(result: MentionableResult): MentionMenuItem[] {
  const users: MentionMenuItem[] = result.users.map((u) => ({
    id: u.id,
    label: u.displayName,
    hint: u.email,
    icon: (u.displayName.trim()[0] ?? "@").toUpperCase(),
    command: { node: "mention", attrs: { kind: "user", id: u.id, label: u.displayName } },
  }));
  const pages: MentionMenuItem[] = result.pages.map((p) => ({
    id: p.id,
    label: p.title || "Untitled",
    hint: "Page",
    icon: p.icon ?? "\u{1F4C4}",
    command: {
      node: "mention",
      attrs: { kind: "page", id: p.id, label: p.title || "Untitled" },
    },
  }));
  return [...users, ...pages];
}

/**
 * Map a mentionable search result to `[[`-page-link menu items. The `[[`
 * trigger only links pages, so users are ignored; each item inserts a
 * `pageLink` node carrying the target page id.
 */
export function mapPagesToPageLinkItems(result: MentionableResult): MentionMenuItem[] {
  return result.pages.map((p) => ({
    id: p.id,
    label: p.title || "Untitled",
    hint: "Page",
    icon: p.icon ?? "\u{1F4C4}",
    command: { node: "pageLink", attrs: { pageId: p.id, label: p.title || "Untitled" } },
  }));
}

/**
 * Insert the node described by a chosen menu item, replacing the trigger range
 * (the `@query` / `[[query`). Followed by a trailing space so typing continues
 * naturally. Pure w.r.t. the editor command chain — exercised directly in tests.
 */
export function runMentionCommand(
  editor: Editor,
  range: Range,
  payload: MentionCommandPayload,
): void {
  editor
    .chain()
    .focus()
    .insertContentAt(range, [
      { type: payload.node, attrs: payload.attrs },
      { type: "text", text: " " },
    ])
    .run();
}

/** Dependencies the suggestion configs need from the host (search + workspace). */
export interface MentionSuggestionDeps {
  api: PagesApi;
  /** Resolves the active workspace id at query time (kept current on page switch). */
  getWorkspaceId: () => string | null;
}

/** Shared options for both the `@` and `[[` suggestion configs. */
interface SuggestionConfig {
  /** Turn a search result into menu items for this trigger. */
  toItems: (result: MentionableResult) => MentionMenuItem[];
  /** CSS class on the floating popup container. */
  popoverClass: string;
}

/**
 * Build a Tiptap suggestion config wired to the mentionable search. Debounces
 * the network call (~200ms) and renders the {@link MentionMenuList} popup at the
 * caret, reusing the slash-menu popup pattern. Selecting an item runs
 * {@link runMentionCommand} to insert the correct node.
 */
function buildSuggestion(
  deps: MentionSuggestionDeps,
  config: SuggestionConfig,
): Omit<SuggestionOptions<MentionMenuItem>, "editor"> {
  return {
    // The host fetches asynchronously in render(); `items` returns the query
    // marker only — the popup owns its own async result list. We return [] and
    // let onUpdate drive the live list to keep Suggestion's state simple.
    items: () => [],
    command: ({ editor, range, props }) => {
      runMentionCommand(editor, range, props.command);
    },
    render: () => {
      let container: HTMLDivElement | null = null;
      let root: Root | null = null;
      let handleRef: MentionMenuListHandle | null = null;
      let items: MentionMenuItem[] = [];
      let loading = false;
      let current: SuggestionProps<MentionMenuItem> | null = null;

      const position = (props: SuggestionProps<MentionMenuItem>): void => {
        if (!container) return;
        const rect = props.clientRect?.();
        if (!rect) return;
        container.style.left = `${rect.left + window.scrollX}px`;
        container.style.top = `${rect.bottom + window.scrollY + 4}px`;
      };

      const renderList = (): void => {
        if (!root) return;
        root.render(
          createElement(MentionMenuList, {
            items,
            loading,
            command: (item: MentionMenuItem) => {
              current?.command(item);
            },
            ref: (h: MentionMenuListHandle | null) => {
              handleRef = h;
            },
          }),
        );
      };

      const search = debounce((query: string) => {
        const wsId = deps.getWorkspaceId();
        if (!wsId) {
          loading = false;
          items = [];
          renderList();
          return;
        }
        deps.api
          .searchMentionable(wsId, query)
          .then((result) => {
            loading = false;
            items = config.toItems(result);
            renderList();
          })
          .catch(() => {
            loading = false;
            items = [];
            renderList();
          });
      }, 200);

      const query = (props: SuggestionProps<MentionMenuItem>): void => {
        loading = true;
        renderList();
        search(props.query);
      };

      return {
        onStart: (props) => {
          current = props;
          container = document.createElement("div");
          container.className = config.popoverClass;
          container.style.position = "absolute";
          container.style.zIndex = "50";
          document.body.appendChild(container);
          root = createRoot(container);
          renderList();
          position(props);
          query(props);
        },
        onUpdate: (props) => {
          current = props;
          position(props);
          query(props);
        },
        onKeyDown: (props) => {
          if (props.event.key === "Escape") return true;
          return handleRef?.onKeyDown(props.event) ?? false;
        },
        onExit: () => {
          search.cancel();
          root?.unmount();
          root = null;
          container?.remove();
          container = null;
          handleRef = null;
          current = null;
          items = [];
          loading = false;
        },
      };
    },
  };
}

/** Suggestion config for the `@`-mention trigger (users + pages). */
export function buildMentionSuggestion(
  deps: MentionSuggestionDeps,
): Omit<SuggestionOptions<MentionMenuItem>, "editor"> {
  return buildSuggestion(deps, {
    toItems: mapMentionableToItems,
    popoverClass: "mention-menu-popover",
  });
}

/** Suggestion config for the `[[`-page-link trigger (pages only). */
export function buildPageLinkSuggestion(
  deps: MentionSuggestionDeps,
): Omit<SuggestionOptions<MentionMenuItem>, "editor"> {
  return buildSuggestion(deps, {
    toItems: mapPagesToPageLinkItems,
    popoverClass: "mention-menu-popover",
  });
}
