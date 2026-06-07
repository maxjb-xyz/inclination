import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  block?: boolean;
  icon?: ReactNode;
  trailingIcon?: ReactNode;
}

/**
 * Styled button used across the app. Keeps native <button> semantics so any
 * `data-testid` / `aria-label` / visible text passed through props survives.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    block = false,
    icon,
    trailingIcon,
    className,
    children,
    disabled,
    type = "button",
    ...rest
  },
  ref,
) {
  const classes = [
    "ui-btn",
    `ui-btn--${variant}`,
    `ui-btn--${size}`,
    block ? "ui-btn--block" : "",
    loading ? "is-loading" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <Spinner size={size === "sm" ? 13 : 15} />
      ) : (
        icon && <span className="ui-btn__icon">{icon}</span>
      )}
      {children != null && <span className="ui-btn__label">{children}</span>}
      {trailingIcon && !loading && (
        <span className="ui-btn__icon ui-btn__icon--trailing">{trailingIcon}</span>
      )}
    </button>
  );
});
