import { describe, expect, it } from "vitest";
import { slugify, uniqueSlug } from "../src/publishing/slug";

describe("slugify", () => {
  it("lowercases and hyphenates words", () => {
    expect(slugify("My Great Page")).toBe("my-great-page");
  });

  it("strips punctuation and collapses separators", () => {
    expect(slugify("Hello, World!! -- Again")).toBe("hello-world-again");
  });

  it("trims leading/trailing hyphens and caps length", () => {
    expect(slugify("  spaced  ")).toBe("spaced");
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(80);
  });

  it("returns empty string when nothing usable remains", () => {
    expect(slugify("!!!")).toBe("");
    expect(slugify("日本語")).toBe("");
  });
});

describe("uniqueSlug", () => {
  it("returns the base when free", async () => {
    expect(await uniqueSlug("notes", async () => false)).toBe("notes");
  });

  it("appends -2, -3 on collision", async () => {
    const taken = new Set(["notes", "notes-2"]);
    expect(await uniqueSlug("notes", async (c) => taken.has(c))).toBe("notes-3");
  });

  it("falls back to 'page' for an empty base", async () => {
    expect(await uniqueSlug("", async () => false)).toBe("page");
  });
});
