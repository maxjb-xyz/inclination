import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { SlashMenuItem } from "@inclination/editor";

export interface SlashMenuListProps {
  items: SlashMenuItem[];
  /** Invoked with the chosen item when the user selects one. */
  command: (item: SlashMenuItem) => void;
}

export interface SlashMenuListHandle {
  /** Returns true if the key event was handled (consumed by the menu). */
  onKeyDown: (event: KeyboardEvent) => boolean;
}

/**
 * The slash-menu popup body: a keyboard-navigable list of block types. The
 * positioning shell is managed by the suggestion renderer in
 * {@link slashSuggestion}; this component owns selection + click/enter handling.
 */
export const SlashMenuList = forwardRef<SlashMenuListHandle, SlashMenuListProps>(
  function SlashMenuList({ items, command }, ref) {
    const [selected, setSelected] = useState(0);

    // Reset the highlight whenever the filtered list changes.
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

    if (items.length === 0) {
      return <div className="slash-menu slash-menu--empty">No matching blocks</div>;
    }

    return (
      <div className="slash-menu" role="listbox" data-testid="slash-menu">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={index === selected}
            className={`slash-menu__item${index === selected ? " is-selected" : ""}`}
            data-item-id={item.id}
            onMouseEnter={() => setSelected(index)}
            onMouseDown={(e) => {
              // mousedown (not click) so the editor selection is not lost first.
              e.preventDefault();
              command(item);
            }}
          >
            <span className="slash-menu__title">{item.title}</span>
            <span className="slash-menu__desc">{item.description}</span>
          </button>
        ))}
      </div>
    );
  },
);
