import { describe, expect, it } from "vitest";
import { filterSlashMenuItems, slashMenuItems } from "@inclination/editor";

describe("slash menu filtering (web consumption)", () => {
  it("re-exports the block registry from @inclination/editor", () => {
    expect(slashMenuItems.length).toBeGreaterThan(0);
    expect(slashMenuItems.map((i) => i.id)).toContain("callout");
  });

  it("filters items by query and returns all on empty", () => {
    expect(filterSlashMenuItems("")).toHaveLength(slashMenuItems.length);
    const todo = filterSlashMenuItems("todo");
    expect(todo.map((i) => i.id)).toContain("taskList");
    expect(filterSlashMenuItems("zzz-nope")).toEqual([]);
  });
});
