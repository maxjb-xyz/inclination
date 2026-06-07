import type { ReactNode } from "react";

export interface SegmentedItem {
  value: string;
  label: ReactNode;
  /** Forwarded to the button so existing testids survive. */
  "data-testid"?: string;
  title?: string;
}

export interface SegmentedProps {
  items: SegmentedItem[];
  value: string;
  onChange: (value: string) => void;
  size?: "sm" | "md";
  /** Accessible group label. */
  ariaLabel?: string;
  className?: string;
}

/**
 * Pill segmented control with a sliding-feel active state. Each option keeps
 * `aria-pressed` (used by the auth + db-view tests).
 */
export function Segmented({
  items,
  value,
  onChange,
  size = "md",
  ariaLabel,
  className,
}: SegmentedProps): React.ReactElement {
  return (
    <div
      className={["ui-segmented", `ui-segmented--${size}`, className ?? ""]
        .filter(Boolean)
        .join(" ")}
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            className={["ui-segmented__item", active ? "is-active" : ""]
              .filter(Boolean)
              .join(" ")}
            aria-pressed={active}
            data-testid={item["data-testid"]}
            title={item.title}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
