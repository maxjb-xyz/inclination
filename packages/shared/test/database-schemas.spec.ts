import { describe, expect, it } from "vitest";
import {
  AGGREGATIONS,
  PROPERTY_TYPES,
  VIEW_TYPES,
  createDatabaseSchema,
  createPropertySchema,
  createViewSchema,
  filterNodeSchema,
  isComputedPropertyType,
  isFilterNode,
  isPropertyType,
  parsePropertyConfig,
  relationLinkSchema,
  setCellSchema,
  updatePropertySchema,
  viewConfigSchema,
  type FilterNode,
} from "../src/index";

const uuid = "00000000-0000-0000-0000-000000000000";
const uuid2 = "11111111-1111-1111-1111-111111111111";

describe("constant surfaces", () => {
  it("covers all 19 spec property types", () => {
    expect(PROPERTY_TYPES).toHaveLength(19);
    expect(PROPERTY_TYPES).toContain("rollup");
    expect(PROPERTY_TYPES).toContain("last_edited_by");
  });

  it("exposes the four view types and core aggregations", () => {
    expect([...VIEW_TYPES]).toEqual(["table", "board", "calendar", "gallery"]);
    for (const agg of ["count", "sum", "avg", "min", "max", "range", "show_original"]) {
      expect(AGGREGATIONS).toContain(agg);
    }
  });
});

describe("type guards", () => {
  it("isPropertyType recognizes valid and rejects invalid types", () => {
    expect(isPropertyType("status")).toBe(true);
    expect(isPropertyType("bogus")).toBe(false);
    expect(isPropertyType(42)).toBe(false);
  });

  it("isComputedPropertyType flags derived types only", () => {
    expect(isComputedPropertyType("formula")).toBe(true);
    expect(isComputedPropertyType("created_time")).toBe(true);
    expect(isComputedPropertyType("text")).toBe(false);
  });

  it("isFilterNode distinguishes groups from leaf conditions", () => {
    const node: FilterNode = { conjunction: "and", conditions: [] };
    expect(isFilterNode(node)).toBe(true);
    expect(isFilterNode({ propertyId: uuid, operator: "equals" })).toBe(false);
  });
});

describe("parsePropertyConfig", () => {
  it("accepts a valid select config and rejects unknown keys", () => {
    expect(
      parsePropertyConfig("select", {
        options: [{ id: "o1", name: "A", color: "blue" }],
      }).success,
    ).toBe(true);
    expect(parsePropertyConfig("select", { options: [], extra: 1 }).success).toBe(
      false,
    );
  });

  it("rejects a select option with an invalid color", () => {
    expect(
      parsePropertyConfig("select", {
        options: [{ id: "o1", name: "A", color: "neon" }],
      }).success,
    ).toBe(false);
  });

  it("validates a relation config requires a uuid target", () => {
    expect(
      parsePropertyConfig("relation", { targetDatabaseId: uuid }).success,
    ).toBe(true);
    expect(
      parsePropertyConfig("relation", { targetDatabaseId: "nope" }).success,
    ).toBe(false);
  });

  it("validates a rollup config requires relation/target/aggregation", () => {
    expect(
      parsePropertyConfig("rollup", {
        relationPropertyId: uuid,
        targetPropertyId: uuid2,
        aggregation: "sum",
      }).success,
    ).toBe(true);
    expect(
      parsePropertyConfig("rollup", {
        relationPropertyId: uuid,
        targetPropertyId: uuid2,
        aggregation: "not_an_agg",
      }).success,
    ).toBe(false);
  });

  it("accepts an empty config for a type that needs none", () => {
    expect(parsePropertyConfig("checkbox", {}).success).toBe(true);
    expect(parsePropertyConfig("text", undefined).success).toBe(true);
  });
});

describe("createPropertySchema", () => {
  it("accepts a typed property with a matching config", () => {
    const r = createPropertySchema.safeParse({
      name: "Tags",
      type: "multi_select",
      config: { options: [{ id: "o1", name: "x", color: "red" }] },
    });
    expect(r.success).toBe(true);
  });

  it("rejects a config that does not match the type", () => {
    const r = createPropertySchema.safeParse({
      name: "Tags",
      type: "multi_select",
      config: { format: "percent" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown property type", () => {
    expect(
      createPropertySchema.safeParse({ name: "X", type: "bogus" }).success,
    ).toBe(false);
  });
});

describe("updatePropertySchema", () => {
  it("requires at least one field", () => {
    expect(updatePropertySchema.safeParse({}).success).toBe(false);
    expect(updatePropertySchema.safeParse({ name: "Renamed" }).success).toBe(true);
  });

  it("checks config against type only when both are present", () => {
    expect(
      updatePropertySchema.safeParse({ config: { whatever: true } }).success,
    ).toBe(true);
    expect(
      updatePropertySchema.safeParse({ type: "number", config: { bad: 1 } }).success,
    ).toBe(false);
  });
});

describe("filterNodeSchema (recursive)", () => {
  it("accepts a nested and/or tree of conditions", () => {
    const tree = {
      conjunction: "and",
      conditions: [
        { propertyId: uuid, operator: "equals", value: "x" },
        {
          conjunction: "or",
          conditions: [
            { propertyId: uuid2, operator: "is_empty" },
            { propertyId: uuid2, operator: "contains", value: "y" },
          ],
        },
      ],
    };
    expect(filterNodeSchema.safeParse(tree).success).toBe(true);
  });

  it("rejects an unknown operator and a bad conjunction", () => {
    expect(
      filterNodeSchema.safeParse({
        conjunction: "and",
        conditions: [{ propertyId: uuid, operator: "frobnicate" }],
      }).success,
    ).toBe(false);
    expect(
      filterNodeSchema.safeParse({ conjunction: "xor", conditions: [] }).success,
    ).toBe(false);
  });
});

describe("viewConfigSchema", () => {
  it("accepts a full table view config", () => {
    const r = viewConfigSchema.safeParse({
      visibleProperties: [uuid, uuid2],
      filters: { conjunction: "and", conditions: [] },
      sorts: [{ propertyId: uuid, direction: "asc" }],
      groupBy: uuid,
      pageSize: 50,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a gallery config and rejects an invalid sort direction", () => {
    expect(
      viewConfigSchema.safeParse({
        gallery: { coverSource: "page_cover", cardSize: "medium" },
      }).success,
    ).toBe(true);
    expect(
      viewConfigSchema.safeParse({
        sorts: [{ propertyId: uuid, direction: "sideways" }],
      }).success,
    ).toBe(false);
  });
});

describe("createViewSchema", () => {
  it("accepts each view type with a name", () => {
    for (const type of VIEW_TYPES) {
      expect(createViewSchema.safeParse({ type, name: "View" }).success).toBe(true);
    }
  });

  it("rejects an unknown view type", () => {
    expect(createViewSchema.safeParse({ type: "timeline", name: "V" }).success).toBe(
      false,
    );
  });
});

describe("createDatabaseSchema / setCellSchema / relationLinkSchema", () => {
  it("createDatabase accepts an empty body or a parent", () => {
    expect(createDatabaseSchema.safeParse({}).success).toBe(true);
    expect(createDatabaseSchema.safeParse({ parentId: null }).success).toBe(true);
    expect(createDatabaseSchema.safeParse({ pageId: "nope" }).success).toBe(false);
  });

  it("setCell requires a propertyId and accepts any json value incl. null", () => {
    expect(setCellSchema.safeParse({ propertyId: uuid, value: null }).success).toBe(
      true,
    );
    expect(
      setCellSchema.safeParse({ propertyId: uuid, value: { rich: true } }).success,
    ).toBe(true);
    expect(setCellSchema.safeParse({ value: "x" }).success).toBe(false);
  });

  it("relationLink requires three uuids", () => {
    expect(
      relationLinkSchema.safeParse({
        propertyId: uuid,
        fromRowId: uuid,
        toRowId: uuid2,
      }).success,
    ).toBe(true);
    expect(
      relationLinkSchema.safeParse({ propertyId: uuid, fromRowId: uuid }).success,
    ).toBe(false);
  });
});
