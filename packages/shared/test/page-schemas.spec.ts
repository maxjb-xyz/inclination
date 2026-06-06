import { describe, expect, it } from "vitest";
import {
  createPageSchema,
  movePageSchema,
  saveContentSchema,
  updatePageSchema,
} from "../src/page-schemas";

const uuid = "00000000-0000-0000-0000-000000000000";

describe("createPageSchema", () => {
  it("accepts an empty object (all fields optional)", () => {
    expect(createPageSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a valid parentId, type, title and icon", () => {
    const r = createPageSchema.safeParse({
      parentId: uuid,
      type: "document",
      title: "Hello",
      icon: "🚀",
    });
    expect(r.success).toBe(true);
  });

  it("allows a null parentId for a root page", () => {
    expect(createPageSchema.safeParse({ parentId: null }).success).toBe(true);
  });

  it("rejects a non-uuid parentId and an unknown type", () => {
    expect(createPageSchema.safeParse({ parentId: "nope" }).success).toBe(false);
    expect(createPageSchema.safeParse({ type: "bogus" }).success).toBe(false);
  });
});

describe("updatePageSchema", () => {
  it("requires at least one field", () => {
    expect(updatePageSchema.safeParse({}).success).toBe(false);
    expect(updatePageSchema.safeParse({ title: "New" }).success).toBe(true);
  });

  it("allows clearing icon and cover with null", () => {
    expect(updatePageSchema.safeParse({ icon: null, cover: null }).success).toBe(true);
  });
});

describe("movePageSchema", () => {
  it("accepts null parent (move to root) and sibling anchors", () => {
    expect(movePageSchema.safeParse({ parentId: null }).success).toBe(true);
    expect(movePageSchema.safeParse({ parentId: uuid, afterId: uuid }).success).toBe(true);
    expect(movePageSchema.safeParse({ beforeId: uuid }).success).toBe(true);
  });

  it("rejects non-uuid anchors", () => {
    expect(movePageSchema.safeParse({ beforeId: "x" }).success).toBe(false);
  });
});

describe("saveContentSchema", () => {
  it("accepts a doc record", () => {
    expect(
      saveContentSchema.safeParse({ doc: { type: "doc", content: [] } }).success,
    ).toBe(true);
  });

  it("rejects a missing or non-object doc", () => {
    expect(saveContentSchema.safeParse({}).success).toBe(false);
    expect(saveContentSchema.safeParse({ doc: "nope" }).success).toBe(false);
  });
});
