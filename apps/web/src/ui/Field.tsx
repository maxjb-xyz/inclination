import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** Optional element rendered inside the input frame on the right (e.g. a reveal toggle). */
  trailing?: ReactNode;
}

/** Bare styled input. Pass `aria-label` through — the tests rely on it. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, trailing, className, ...rest },
  ref,
) {
  const input = (
    <input
      ref={ref}
      className={["ui-input", invalid ? "is-invalid" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
  if (!trailing) return input;
  return (
    <div className={["ui-input-wrap", invalid ? "is-invalid" : ""].filter(Boolean).join(" ")}>
      {input}
      <span className="ui-input-wrap__trailing">{trailing}</span>
    </div>
  );
});

export interface FieldProps {
  label: string;
  /** Pass to the inner input as aria-label/id; defaults to the visible label text. */
  htmlFor?: string;
  hint?: ReactNode;
  /** Inline validation message — rendered with role="alert" when present. */
  error?: ReactNode;
  children: ReactNode;
}

/** Composes a visible label + control + helper/error text. */
export function Field({ label, htmlFor, hint, error, children }: FieldProps): React.ReactElement {
  const generated = useId();
  const id = htmlFor ?? generated;
  return (
    <div className={["ui-field", error ? "has-error" : ""].filter(Boolean).join(" ")}>
      <label className="ui-field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="ui-field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="ui-field__hint">{hint}</p>
      ) : null}
    </div>
  );
}
