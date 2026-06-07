import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "default" | "ghost" | "danger";
type Size = "sm" | "md";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** REQUIRED accessible name — icon-only buttons must carry it for the tests + a11y. */
  label: string;
  variant?: Variant;
  size?: Size;
  active?: boolean;
  children: ReactNode;
}

/** Icon-only button. `label` becomes both `aria-label` and the tooltip title. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      label,
      variant = "ghost",
      size = "md",
      active = false,
      className,
      children,
      type = "button",
      ...rest
    },
    ref,
  ) {
    const classes = [
      "ui-iconbtn",
      `ui-iconbtn--${variant}`,
      `ui-iconbtn--${size}`,
      active ? "is-active" : "",
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <button
        ref={ref}
        type={type}
        className={classes}
        aria-label={label}
        title={label}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
