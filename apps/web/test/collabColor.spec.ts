import { describe, expect, it } from "vitest";
import { colorForUserId, PRESENCE_PALETTE } from "../src/collab/color";

describe("colorForUserId", () => {
  it("is deterministic for the same user id", () => {
    expect(colorForUserId("user-abc")).toBe(colorForUserId("user-abc"));
  });

  it("always returns a color from the palette", () => {
    for (const id of ["a", "user-123", "00000000-0000-0000-0000-000000000000", "x".repeat(40)]) {
      expect(PRESENCE_PALETTE).toContain(colorForUserId(id));
    }
  });

  it("returns the first palette color for an empty id", () => {
    expect(colorForUserId("")).toBe(PRESENCE_PALETTE[0]);
  });

  it("spreads different ids across more than one palette entry", () => {
    const colors = new Set(Array.from({ length: 50 }, (_, i) => colorForUserId(`user-${i}`)));
    // Not asserting full coverage (hash-dependent), but a single bucket would
    // indicate the hash/index math collapsed.
    expect(colors.size).toBeGreaterThan(1);
  });
});
