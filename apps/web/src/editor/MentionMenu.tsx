import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

/** A single entry in the `@`/`[[` autocomplete popup. */
export interface MentionMenuItem {
  /** Stable key for the option (the user/page id). */
  id: string;
  /** Primary label shown in the row. */
  label: string;
  /** Optional secondary text (email for users, "Page" for pages). */
  hint?: string;
  /** Optional leading glyph (avatar initial / page icon). */
  icon?: string;
  /** The attrs handed to the suggestion command when this item is chosen. */
  command: MentionCommandPayload;
}

/** What the suggestion `command` receives when an item is selected. */
export type MentionCommandPayload =
  | { node: "mention"; attrs: { kind: "user" | "page"; id: string; label: string } }
  | { node: "pageLink"; attrs: { pageId: string; label: string } };

export interface MentionMenuListProps {
  items: MentionMenuItem[];
  loading: boolean;
  /** Invoked with the chosen item when the user selects one. */
  command: (item: MentionMenuItem) => void;
}

export interface MentionMenuListHandle {
  /** Returns true if the key event was handled (consumed by the menu). */
  onKeyDown: (event: KeyboardEvent) => boolean;
}

/**
 * Popup body for the `@`-mention / `[[`-page-link autocomplete. Mirrors the
 * slash-menu list: keyboard-navigable, mouse-selectable, with the positioning
 * shell owned by the suggestion renderer. Reused for both triggers.
 */
export const MentionMenuList = forwardRef<MentionMenuListHandle, MentionMenuListProps>(
  function MentionMenuList({ items, loading, command }, ref) {
    const [selected, setSelected] = useState(0);

    useEffect(() => setSelected(0), [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: (event) => {
        if (items.length === 0) return false;
        if (event.key === "ArrowUp") {
          setSelected((s) => (s + items.length - 1) % items.length);
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelected((s) => (s + 1) % items.length);
          return true;
        }
        if (event.key === "Enter") {
          const item = items[selected];
          if (item) command(item);
          return true;
        }
        return false;
      },
    }));

    if (loading && items.length === 0) {
      return <div className="mention-menu mention-menu--empty">Searching…</div>;
    }
    if (items.length === 0) {
      return <div className="mention-menu mention-menu--empty">No matches</div>;
    }

    return (
      <div className="mention-menu" role="listbox" data-testid="mention-menu">
        {items.map((item, index) => (
          <button
            key={`${item.command.node}:${item.id}`}
            type="button"
            role="option"
            aria-selected={index === selected}
            className={`mention-menu__item${index === selected ? " is-selected" : ""}`}
            data-item-id={item.id}
            onMouseEnter={() => setSelected(index)}
            onMouseDown={(e) => {
              e.preventDefault();
              command(item);
            }}
          >
            {item.icon ? <span className="mention-menu__icon">{item.icon}</span> : null}
            <span className="mention-menu__label">{item.label}</span>
            {item.hint ? <span className="mention-menu__hint">{item.hint}</span> : null}
          </button>
        ))}
      </div>
    );
  },
);
