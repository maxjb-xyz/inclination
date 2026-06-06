import { useReducer } from "react";
import {
  isFilterNode,
  type FilterCondition,
  type FilterNode,
  type Sort,
  type ViewConfig,
} from "@inclination/shared";
import type { Property, View } from "./dbTypes";
import {
  emptyFilter,
  filterReducer,
  operatorTakesValue,
  operatorsForType,
} from "./filterBuilder";

export interface ViewControlsProps {
  view: View;
  properties: Property[];
  /** Persist a config patch via PATCH /views/:id. */
  onConfigChange: (config: ViewConfig) => void;
}

/**
 * Per-view controls: filter builder, sort, group-by, and visible properties.
 * Each control writes the merged `ViewConfig` back through `onConfigChange`
 * (the caller PATCHes the view).
 */
export function ViewControls({
  view,
  properties,
  onConfigChange,
}: ViewControlsProps): React.ReactElement {
  const config = view.config;

  return (
    <div className="db-view-controls" data-testid="db-view-controls">
      <FilterControl
        properties={properties}
        filter={config.filters}
        onChange={(filters) => onConfigChange({ ...config, filters })}
      />
      <SortControl
        properties={properties}
        sorts={config.sorts ?? []}
        onChange={(sorts) => onConfigChange({ ...config, sorts })}
      />
      <GroupByControl
        view={view}
        properties={properties}
        onChange={(groupBy) => onConfigChange({ ...config, groupBy })}
      />
      <VisiblePropertiesControl
        properties={properties}
        visible={config.visibleProperties}
        onChange={(visibleProperties) => onConfigChange({ ...config, visibleProperties })}
      />
    </div>
  );
}

function FilterControl({
  properties,
  filter,
  onChange,
}: {
  properties: Property[];
  filter: FilterNode | undefined;
  onChange: (filter: FilterNode) => void;
}): React.ReactElement {
  const [state, dispatch] = useReducer(filterReducer, filter ?? emptyFilter());

  function commit(next: FilterNode): void {
    onChange(next);
  }

  const conditions = state.conditions.filter(
    (c): c is FilterCondition => !isFilterNode(c),
  );

  return (
    <div className="db-filter" data-testid="db-filter">
      <div className="db-filter__head">
        <span>Filter</span>
        <select
          aria-label="Filter conjunction"
          value={state.conjunction}
          onChange={(e) => {
            const next = filterReducer(state, {
              type: "setConjunction",
              conjunction: e.target.value as "and" | "or",
            });
            dispatch({ type: "setConjunction", conjunction: e.target.value as "and" | "or" });
            commit(next);
          }}
        >
          <option value="and">All (AND)</option>
          <option value="or">Any (OR)</option>
        </select>
      </div>
      {conditions.map((cond, index) => {
        const prop = properties.find((p) => p.id === cond.propertyId);
        const ops = prop ? operatorsForType(prop.type) : [];
        return (
          <div key={index} className="db-filter__row" data-testid="db-filter-row">
            <select
              aria-label="Filter property"
              value={cond.propertyId}
              onChange={(e) => {
                const next = filterReducer(state, {
                  type: "updateCondition",
                  index,
                  patch: { propertyId: e.target.value },
                });
                dispatch({ type: "updateCondition", index, patch: { propertyId: e.target.value } });
                commit(next);
              }}
            >
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter operator"
              value={cond.operator}
              onChange={(e) => {
                const next = filterReducer(state, {
                  type: "updateCondition",
                  index,
                  patch: { operator: e.target.value },
                });
                dispatch({ type: "updateCondition", index, patch: { operator: e.target.value } });
                commit(next);
              }}
            >
              {ops.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            {operatorTakesValue(cond.operator) ? (
              <input
                aria-label="Filter value"
                value={typeof cond.value === "string" ? cond.value : ""}
                onChange={(e) => {
                  const next = filterReducer(state, {
                    type: "updateCondition",
                    index,
                    patch: { value: e.target.value },
                  });
                  dispatch({ type: "updateCondition", index, patch: { value: e.target.value } });
                  commit(next);
                }}
              />
            ) : null}
            <button
              type="button"
              aria-label="Remove filter"
              onClick={() => {
                const next = filterReducer(state, { type: "removeCondition", index });
                dispatch({ type: "removeCondition", index });
                commit(next);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        type="button"
        data-testid="db-add-filter"
        disabled={properties.length === 0}
        onClick={() => {
          const first = properties[0];
          if (!first) return;
          const condition: FilterCondition = {
            propertyId: first.id,
            operator: operatorsForType(first.type)[0] ?? "equals",
          };
          const next = filterReducer(state, { type: "addCondition", condition });
          dispatch({ type: "addCondition", condition });
          commit(next);
        }}
      >
        + Add filter
      </button>
    </div>
  );
}

function SortControl({
  properties,
  sorts,
  onChange,
}: {
  properties: Property[];
  sorts: Sort[];
  onChange: (sorts: Sort[]) => void;
}): React.ReactElement {
  const sort = sorts[0];
  return (
    <div className="db-sort" data-testid="db-sort">
      <span>Sort</span>
      <select
        aria-label="Sort property"
        value={sort?.propertyId ?? ""}
        onChange={(e) => {
          if (e.target.value === "") return onChange([]);
          onChange([{ propertyId: e.target.value, direction: sort?.direction ?? "asc" }]);
        }}
      >
        <option value="">None</option>
        {properties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {sort ? (
        <select
          aria-label="Sort direction"
          value={sort.direction}
          onChange={(e) =>
            onChange([{ propertyId: sort.propertyId, direction: e.target.value as "asc" | "desc" }])
          }
        >
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      ) : null}
    </div>
  );
}

function GroupByControl({
  view,
  properties,
  onChange,
}: {
  view: View;
  properties: Property[];
  onChange: (groupBy: string | undefined) => void;
}): React.ReactElement {
  // Board groups by a select/status property; offer those.
  const groupable = properties.filter(
    (p) => p.type === "select" || p.type === "status",
  );
  return (
    <div className="db-groupby" data-testid="db-groupby">
      <span>Group by</span>
      <select
        aria-label="Group by property"
        value={view.config.groupBy ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      >
        <option value="">None</option>
        {groupable.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function VisiblePropertiesControl({
  properties,
  visible,
  onChange,
}: {
  properties: Property[];
  visible: string[] | undefined;
  onChange: (visible: string[]) => void;
}): React.ReactElement {
  const set = new Set(visible ?? properties.map((p) => p.id));
  return (
    <div className="db-visible-props" data-testid="db-visible-props">
      <span>Properties</span>
      {properties.map((p) => (
        <label key={p.id} className="db-visible-props__item">
          <input
            type="checkbox"
            checked={set.has(p.id)}
            onChange={(e) => {
              const next = new Set(set);
              if (e.target.checked) next.add(p.id);
              else next.delete(p.id);
              // Preserve definition order.
              onChange(properties.filter((q) => next.has(q.id)).map((q) => q.id));
            }}
          />
          {p.name}
        </label>
      ))}
    </div>
  );
}
