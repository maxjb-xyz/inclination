import { describe, expect, it } from "vitest";
import { moveCardValue } from "../src/databases/boardMove";

describe("moveCardValue", () => {
  it("maps a group key to the option id", () => {
    expect(moveCardValue("opt-done")).toBe("opt-done");
  });

  it("maps the empty group key to null (clears the cell)", () => {
    expect(moveCardValue("")).toBeNull();
  });
});
