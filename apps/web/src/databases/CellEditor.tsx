import { useState } from "react";
import type { CellValue, DateValue, FileValue, Property } from "./dbTypes";
import { propertyOptions } from "./cellHelpers";

export interface CellEditorProps {
  property: Property;
  value: CellValue;
  /** Commit a new value (null clears the cell). */
  onChange: (value: CellValue) => void;
  disabled?: boolean;
}

/**
 * Inline editor for a single settable cell, dispatched on the property type.
 * Computed/relation types are rendered read-only by the views, not here.
 */
export function CellEditor({
  property,
  value,
  onChange,
  disabled,
}: CellEditorProps): React.ReactElement {
  const testId = `cell-editor-${property.type}`;
  switch (property.type) {
    case "checkbox":
      return (
        <input
          type="checkbox"
          aria-label={property.name}
          data-testid={testId}
          checked={value === true}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case "number":
      return (
        <TextLikeEditor
          testId={testId}
          ariaLabel={property.name}
          type="number"
          disabled={disabled}
          initial={typeof value === "number" ? String(value) : ""}
          commit={(raw) => onChange(raw === "" ? null : Number(raw))}
        />
      );
    case "url":
    case "email":
    case "phone":
    case "text":
      return (
        <TextLikeEditor
          testId={testId}
          ariaLabel={property.name}
          disabled={disabled}
          initial={typeof value === "string" ? value : ""}
          commit={(raw) => onChange(raw === "" ? null : raw)}
        />
      );
    case "select":
    case "status":
      return (
        <select
          aria-label={property.name}
          data-testid={testId}
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        >
          <option value="">—</option>
          {propertyOptions(property).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      );
    case "multi_select":
      return (
        <MultiSelectEditor property={property} value={value} onChange={onChange} disabled={disabled} />
      );
    case "date":
      return <DateEditor value={value} onChange={onChange} ariaLabel={property.name} disabled={disabled} />;
    case "person":
      return (
        <TextLikeEditor
          testId={testId}
          ariaLabel={property.name}
          disabled={disabled}
          initial={Array.isArray(value) ? value.join(",") : ""}
          commit={(raw) =>
            onChange(
              raw.trim() === "" ? null : raw.split(",").map((s) => s.trim()).filter(Boolean),
            )
          }
        />
      );
    case "files":
      return <FilesEditor value={value} onChange={onChange} ariaLabel={property.name} disabled={disabled} />;
    default:
      return <span data-testid="cell-editor-readonly" />;
  }
}

function TextLikeEditor({
  initial,
  commit,
  ariaLabel,
  testId,
  type,
  disabled,
}: {
  initial: string;
  commit: (raw: string) => void;
  ariaLabel: string;
  testId: string;
  type?: string;
  disabled?: boolean;
}): React.ReactElement {
  const [draft, setDraft] = useState(initial);
  // Reset when the underlying value changes (e.g. realtime patch).
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setDraft(initial);
  }
  return (
    <input
      type={type ?? "text"}
      aria-label={ariaLabel}
      data-testid={testId}
      disabled={disabled}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== initial) commit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function MultiSelectEditor({
  property,
  value,
  onChange,
  disabled,
}: {
  property: Property;
  value: CellValue;
  onChange: (v: CellValue) => void;
  disabled?: boolean;
}): React.ReactElement {
  const selected = new Set(Array.isArray(value) ? value.map(String) : []);
  return (
    <div className="db-multiselect" data-testid="cell-editor-multi_select">
      {propertyOptions(property).map((o) => (
        <label key={o.id} className="db-multiselect__opt">
          <input
            type="checkbox"
            disabled={disabled}
            checked={selected.has(o.id)}
            onChange={(e) => {
              const next = new Set(selected);
              if (e.target.checked) next.add(o.id);
              else next.delete(o.id);
              onChange(next.size === 0 ? null : [...next]);
            }}
          />
          {o.name}
        </label>
      ))}
    </div>
  );
}

function DateEditor({
  value,
  onChange,
  ariaLabel,
  disabled,
}: {
  value: CellValue;
  onChange: (v: CellValue) => void;
  ariaLabel: string;
  disabled?: boolean;
}): React.ReactElement {
  const date = (value as DateValue | null) ?? null;
  return (
    <input
      type="date"
      aria-label={ariaLabel}
      data-testid="cell-editor-date"
      disabled={disabled}
      value={date?.start ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : { start: e.target.value })}
    />
  );
}

function FilesEditor({
  value,
  onChange,
  ariaLabel,
  disabled,
}: {
  value: CellValue;
  onChange: (v: CellValue) => void;
  ariaLabel: string;
  disabled?: boolean;
}): React.ReactElement {
  const files = (Array.isArray(value) ? (value as FileValue[]) : []).filter(
    (f): f is FileValue => typeof f === "object" && f !== null && "url" in f,
  );
  const [draft, setDraft] = useState(files.map((f) => f.url).join(", "));
  return (
    <input
      type="text"
      aria-label={ariaLabel}
      data-testid="cell-editor-files"
      placeholder="Comma-separated URLs"
      disabled={disabled}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const urls = draft.split(",").map((s) => s.trim()).filter(Boolean);
        onChange(urls.length === 0 ? null : urls.map((url) => ({ url })));
      }}
    />
  );
}
