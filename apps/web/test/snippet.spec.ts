import { describe, expect, it } from "vitest";
import { parseSnippet } from "../src/pages/snippet";

describe("parseSnippet", () => {
  it("splits [[ ]] markers into highlight + plain parts", () => {
    const parts = parseSnippet("the [[quick]] brown [[fox]]");
    expect(parts).toEqual([
      { text: "the ", highlight: false },
      { text: "quick", highlight: true },
      { text: " brown ", highlight: false },
      { text: "fox", highlight: true },
    ]);
  });

  it("treats text with no markers as a single plain part", () => {
    expect(parseSnippet("plain text")).toEqual([{ text: "plain text", highlight: false }]);
  });

  it("strips the markers from the emitted text", () => {
    const joined = parseSnippet("a [[b]] c")
      .map((p) => p.text)
      .join("");
    expect(joined).toBe("a b c");
  });

  it("ignores empty markers (no highlight emitted)", () => {
    const parts = parseSnippet("a [[]] b");
    expect(parts.every((p) => !p.highlight)).toBe(true);
    expect(parts.map((p) => p.text).join("")).toBe("a  b");
  });
});
