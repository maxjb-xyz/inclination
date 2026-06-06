import { useState } from "react";
import {
  AGGREGATIONS,
  PROPERTY_OPTION_COLORS,
  PROPERTY_TYPES,
  type PropertyType,
} from "@inclination/shared";
import type {
  CreatePropertyInput,
  UpdatePropertyInput,
} from "@inclination/shared";
import type { Database, Property } from "./dbTypes";
import { propertyOptions } from "./cellHelpers";

export interface AddPropertyFormProps {
  /** Other databases in the workspace, for relation targets. */
  relationTargets: { id: string; title: string }[];
  /** This database (for rollup relation-property + own props). */
  database: Database;
  onCreate: (input: CreatePropertyInput) => void;
  onCancel: () => void;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Build a default config for a newly-chosen property type. */
function defaultConfig(
  type: PropertyType,
  relationTargets: { id: string }[],
  database: Database,
): Record<string, unknown> {
  switch (type) {
    case "select":
    case "multi_select":
      return { options: [] };
    case "status":
      return { options: [], groups: [] };
    case "relation":
      return { targetDatabaseId: relationTargets[0]?.id ?? "" };
    case "rollup":
      return {
        relationPropertyId: database.properties.find((p) => p.type === "relation")?.id ?? "",
        targetPropertyId: "",
        aggregation: "count" as const,
      };
    case "formula":
      return { expression: "" };
    default:
      return {};
  }
}

/**
 * Form to add a property: pick a type, then configure type-specific options
 * (select/status options, relation target, rollup relation+target+aggregation,
 * formula expression).
 */
export function AddPropertyForm({
  relationTargets,
  database,
  onCreate,
  onCancel,
}: AddPropertyFormProps): React.ReactElement {
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyType>("text");
  const [config, setConfig] = useState<Record<string, unknown>>({});

  function changeType(next: PropertyType): void {
    setType(next);
    setConfig(defaultConfig(next, relationTargets, database));
  }

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate({ name: name.trim(), type, config });
  }

  return (
    <form className="db-prop-form" data-testid="db-add-property-form" onSubmit={submit}>
      <input
        aria-label="Property name"
        placeholder="Property name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <select
        aria-label="Property type"
        value={type}
        onChange={(e) => changeType(e.target.value as PropertyType)}
      >
        {PROPERTY_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      <TypeConfigEditor
        type={type}
        config={config}
        setConfig={setConfig}
        relationTargets={relationTargets}
        database={database}
      />

      <div className="db-prop-form__actions">
        <button type="submit" data-testid="db-add-property-submit">
          Add
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Type-specific config inputs, shared by add + edit forms. */
export function TypeConfigEditor({
  type,
  config,
  setConfig,
  relationTargets,
  database,
}: {
  type: PropertyType;
  config: Record<string, unknown>;
  setConfig: (c: Record<string, unknown>) => void;
  relationTargets: { id: string; title: string }[];
  database: Database;
}): React.ReactElement | null {
  if (type === "select" || type === "multi_select" || type === "status") {
    return <OptionsEditor config={config} setConfig={setConfig} />;
  }
  if (type === "relation") {
    return (
      <select
        aria-label="Relation target database"
        value={(config.targetDatabaseId as string) ?? ""}
        onChange={(e) => setConfig({ ...config, targetDatabaseId: e.target.value })}
      >
        <option value="">Pick a database…</option>
        {relationTargets.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title || "Untitled"}
          </option>
        ))}
      </select>
    );
  }
  if (type === "rollup") {
    const relationProps = database.properties.filter((p) => p.type === "relation");
    return (
      <div className="db-rollup-config">
        <select
          aria-label="Rollup relation property"
          value={(config.relationPropertyId as string) ?? ""}
          onChange={(e) => setConfig({ ...config, relationPropertyId: e.target.value })}
        >
          <option value="">Relation…</option>
          {relationProps.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          aria-label="Rollup target property id"
          placeholder="Target property id"
          value={(config.targetPropertyId as string) ?? ""}
          onChange={(e) => setConfig({ ...config, targetPropertyId: e.target.value })}
        />
        <select
          aria-label="Rollup aggregation"
          value={(config.aggregation as string) ?? "count"}
          onChange={(e) => setConfig({ ...config, aggregation: e.target.value })}
        >
          {AGGREGATIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (type === "formula") {
    return (
      <textarea
        aria-label="Formula expression"
        placeholder="e.g. if(prop('Done'), 1, 0)"
        value={(config.expression as string) ?? ""}
        onChange={(e) => setConfig({ ...config, expression: e.target.value })}
      />
    );
  }
  return null;
}

/** Edit the option list for a select/multi_select/status property. */
function OptionsEditor({
  config,
  setConfig,
}: {
  config: Record<string, unknown>;
  setConfig: (c: Record<string, unknown>) => void;
}): React.ReactElement {
  const options = (config.options as { id: string; name: string; color: string }[]) ?? [];
  const [draft, setDraft] = useState("");

  function add(): void {
    if (!draft.trim()) return;
    const next = [...options, { id: uid(), name: draft.trim(), color: PROPERTY_OPTION_COLORS[0] }];
    setConfig({ ...config, options: next });
    setDraft("");
  }

  return (
    <div className="db-options-editor" data-testid="db-options-editor">
      <ul>
        {options.map((o, i) => (
          <li key={o.id}>
            {o.name}
            <button
              type="button"
              aria-label={`Remove ${o.name}`}
              onClick={() => setConfig({ ...config, options: options.filter((_, j) => j !== i) })}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="db-options-editor__add">
        <input
          aria-label="New option name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" onClick={add}>
          + Option
        </button>
      </div>
    </div>
  );
}

export interface EditPropertyFormProps {
  property: Property;
  relationTargets: { id: string; title: string }[];
  database: Database;
  onSave: (input: UpdatePropertyInput) => void;
  onDelete: () => void;
  onClose: () => void;
}

/** Edit an existing property's name and type-specific config. */
export function EditPropertyForm({
  property,
  relationTargets,
  database,
  onSave,
  onDelete,
  onClose,
}: EditPropertyFormProps): React.ReactElement {
  const [name, setName] = useState(property.name);
  const [config, setConfig] = useState<Record<string, unknown>>(
    property.type === "select" || property.type === "multi_select" || property.type === "status"
      ? { options: propertyOptions(property) }
      : (property.config as Record<string, unknown>),
  );

  return (
    <div className="db-prop-form" data-testid="db-edit-property-form">
      <input
        aria-label="Property name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <TypeConfigEditor
        type={property.type}
        config={config}
        setConfig={setConfig}
        relationTargets={relationTargets}
        database={database}
      />
      <div className="db-prop-form__actions">
        <button
          type="button"
          data-testid="db-edit-property-save"
          onClick={() => onSave({ name: name.trim(), config })}
        >
          Save
        </button>
        {!property.isPrimary ? (
          <button type="button" className="db-danger" onClick={onDelete}>
            Delete
          </button>
        ) : null}
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
