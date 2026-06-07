import type { CSSProperties, ReactNode } from "react";

type Tone = "neutral" | "accent" | "success" | "danger" | "warning";

export function Badge({
  children,
  tone = "neutral",
  style,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  style?: CSSProperties;
  className?: string;
}): React.ReactElement {
  return (
    <span
      className={["ui-badge", `ui-badge--${tone}`, className ?? ""]
        .filter(Boolean)
        .join(" ")}
      style={style}
    >
      {children}
    </span>
  );
}

/**
 * Colored chip for select / status / relation cells. Accepts an arbitrary
 * color and renders a soft tinted background derived from it.
 */
export function Chip({
  children,
  color,
  onRemove,
  className,
}: {
  children: ReactNode;
  color?: string;
  onRemove?: () => void;
  className?: string;
}): React.ReactElement {
  const style: CSSProperties = color
    ? { background: `color-mix(in srgb, ${color} 18%, transparent)`, color }
    : {};
  return (
    <span className={["ui-chip", className ?? ""].filter(Boolean).join(" ")} style={style}>
      {children}
      {onRemove && (
        <button type="button" className="ui-chip__x" aria-label="Remove" onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  );
}
