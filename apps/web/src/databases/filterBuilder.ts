import {
  FILTER_OPERATORS,
  type FilterCondition,
  type FilterConjunction,
  type FilterNode,
  type PropertyType,
} from "@inclination/shared";

/**
 * Pure reducer for the per-view filter builder. The builder edits a single flat
 * `FilterNode` (one conjunction + a list of leaf conditions) — nested groups are
 * out of scope for the v1 UI, though the persisted shape stays a `FilterNode`
 * tree so the API and engine are unchanged. Kept side-effect-free for unit tests.
 */

export type FilterAction =
  | { type: "setConjunction"; conjunction: FilterConjunction }
  | { type: "addCondition"; condition: FilterCondition }
  | { type: "removeCondition"; index: number }
  | { type: "updateCondition"; index: number; patch: Partial<FilterCondition> };

/** An empty AND filter (no conditions). */
export function emptyFilter(): FilterNode {
  return { conjunction: "and", conditions: [] };
}

export function filterReducer(state: FilterNode, action: FilterAction): FilterNode {
  switch (action.type) {
    case "setConjunction":
      return { ...state, conjunction: action.conjunction };
    case "addCondition":
      return { ...state, conditions: [...state.conditions, action.condition] };
    case "removeCondition":
      return {
        ...state,
        conditions: state.conditions.filter((_, i) => i !== action.index),
      };
    case "updateCondition":
      return {
        ...state,
        conditions: state.conditions.map((c, i) =>
          i === action.index ? { ...(c as FilterCondition), ...action.patch } : c,
        ),
      };
    default:
      return state;
  }
}

/** Map a property type to its filter-operator category (default: text). */
export function operatorCategory(type: PropertyType): keyof typeof FILTER_OPERATORS {
  switch (type) {
    case "number":
      return "number";
    case "select":
    case "status":
      return "select";
    case "multi_select":
      return "multi_select";
    case "date":
    case "created_time":
    case "last_edited_time":
      return "date";
    case "checkbox":
      return "checkbox";
    case "person":
    case "created_by":
    case "last_edited_by":
      return "person";
    case "relation":
      return "relation";
    default:
      return "text";
  }
}

/** The operators offered for a property type. */
export function operatorsForType(type: PropertyType): readonly string[] {
  return FILTER_OPERATORS[operatorCategory(type)];
}

/** Operators that take no operand value (the value input is hidden). */
const VALUELESS_OPERATORS = new Set(["is_empty", "is_not_empty"]);

export function operatorTakesValue(operator: string): boolean {
  return !VALUELESS_OPERATORS.has(operator);
}
