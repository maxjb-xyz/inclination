import { describe, expect, it } from "vitest";
import {
  emptyFilter,
  filterReducer,
  operatorsForType,
  operatorTakesValue,
} from "../src/databases/filterBuilder";
import { isFilterNode, type FilterCondition } from "@inclination/shared";

describe("filterReducer", () => {
  it("adds, updates and removes conditions", () => {
    let state = emptyFilter();
    expect(state.conditions).toHaveLength(0);

    const cond: FilterCondition = { propertyId: "p1", operator: "equals", value: "x" };
    state = filterReducer(state, { type: "addCondition", condition: cond });
    expect(state.conditions).toHaveLength(1);
    expect(state.conditions[0]).toEqual(cond);

    state = filterReducer(state, {
      type: "updateCondition",
      index: 0,
      patch: { operator: "contains", value: "y" },
    });
    const updated = state.conditions[0] as FilterCondition;
    expect(updated.operator).toBe("contains");
    expect(updated.value).toBe("y");
    expect(updated.propertyId).toBe("p1");

    state = filterReducer(state, { type: "removeCondition", index: 0 });
    expect(state.conditions).toHaveLength(0);
  });

  it("sets the conjunction (and produces a valid FilterNode)", () => {
    let state = emptyFilter();
    state = filterReducer(state, { type: "setConjunction", conjunction: "or" });
    expect(state.conjunction).toBe("or");
    expect(isFilterNode(state)).toBe(true);
  });

  it("removeCondition only affects the targeted index", () => {
    let state = emptyFilter();
    state = filterReducer(state, {
      type: "addCondition",
      condition: { propertyId: "a", operator: "equals" },
    });
    state = filterReducer(state, {
      type: "addCondition",
      condition: { propertyId: "b", operator: "equals" },
    });
    state = filterReducer(state, { type: "removeCondition", index: 0 });
    expect((state.conditions[0] as FilterCondition).propertyId).toBe("b");
  });
});

describe("operator helpers", () => {
  it("maps property types to operator sets", () => {
    expect(operatorsForType("number")).toContain("greater_than");
    expect(operatorsForType("checkbox")).toEqual(["equals"]);
    expect(operatorsForType("status")).toContain("equals");
    expect(operatorsForType("date")).toContain("before");
  });

  it("knows which operators take a value", () => {
    expect(operatorTakesValue("equals")).toBe(true);
    expect(operatorTakesValue("is_empty")).toBe(false);
    expect(operatorTakesValue("is_not_empty")).toBe(false);
  });
});
