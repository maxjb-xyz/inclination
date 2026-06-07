import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "./IconButton";

export interface DialogProps {
  open?: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Forwarded to the dialog card (keep existing testids/roles). */
  "data-testid"?: string;
  role?: "dialog" | "alertdialog";
  ariaLabel?: string;
  width?: number;
  className?: string;
  /** Extra class for the backdrop, so legacy selectors keep working. */
  backdropClassName?: string;
}

/**
 * Centered modal card: scrim, Esc-to-close, click-outside, focus trap,
 * autofocus first field. Thin wrapper — caller owns header text/testids.
 */
export function Dialog({
  open = true,
  onClose,
  title,
  children,
  footer,
  role = "dialog",
  ariaLabel,
  width = 480,
  className,
  backdropClassName,
  ...rest
}: DialogProps): React.ReactElement | null {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab") trapFocus(e, cardRef.current);
    }
    document.addEventListener("keydown", onKey, true);
    // Autofocus the first focusable control.
    const first = cardRef.current?.querySelector<HTMLElement>(
      'input,textarea,select,button,[tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={["ui-dialog__backdrop", backdropClassName ?? ""].filter(Boolean).join(" ")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        className={["ui-dialog", className ?? ""].filter(Boolean).join(" ")}
        role={role}
        aria-modal="true"
        aria-label={ariaLabel}
        style={{ width: `min(${width}px, 94vw)` }}
        {...rest}
      >
        {title != null && (
          <div className="ui-dialog__header">
            <h2 className="ui-dialog__title">{title}</h2>
            <IconButton label="Close" size="sm" onClick={onClose}>
              <X size={16} />
            </IconButton>
          </div>
        )}
        <div className="ui-dialog__body">{children}</div>
        {footer != null && <div className="ui-dialog__footer">{footer}</div>}
      </div>
    </div>
  );
}

function trapFocus(e: KeyboardEvent, container: HTMLElement | null): void {
  if (!container) return;
  const focusable = Array.from(
    container.querySelectorAll<HTMLElement>(
      'input,textarea,select,button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  const active = document.activeElement as HTMLElement | null;
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}
