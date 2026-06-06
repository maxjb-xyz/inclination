import { describe, expect, it } from "vitest";
import { shouldWriteGrant } from "../src/sharing/share-decision";

/**
 * Phase 9 — share-invite "no-downgrade" decision (Phase 6 follow-up).
 *
 * The rule: never write a weaker explicit grant for a subject who already
 * resolves to an equal-or-higher role via a default/inherited grant (that would
 * DOWNGRADE them, since an explicit grant beats the default). Re-writing an
 * existing explicit grant is always allowed (it's the subject's own row).
 */
describe("shouldWriteGrant (no-downgrade)", () => {
  it("writes when the subject has no access yet", () => {
    expect(shouldWriteGrant(null, "read", false)).toBe(true);
    expect(shouldWriteGrant(null, "full", false)).toBe(true);
  });

  it("SKIPS when an admin (full via default) is invited at a weaker role", () => {
    // The crux: granting `read` to an owner/admin who resolves to `full` would
    // downgrade them — skip.
    expect(shouldWriteGrant("full", "read", false)).toBe(false);
    expect(shouldWriteGrant("full", "comment", false)).toBe(false);
    expect(shouldWriteGrant("full", "edit", false)).toBe(false);
  });

  it("SKIPS when a member (edit via default) is invited at edit-or-weaker", () => {
    expect(shouldWriteGrant("edit", "edit", false)).toBe(false);
    expect(shouldWriteGrant("edit", "read", false)).toBe(false);
  });

  it("writes when the requested role is STRICTLY higher than current (an upgrade)", () => {
    expect(shouldWriteGrant("read", "edit", false)).toBe(true);
    expect(shouldWriteGrant("edit", "full", false)).toBe(true);
    expect(shouldWriteGrant("comment", "edit", false)).toBe(true);
  });

  it("always writes when an explicit grant already exists on the page (adjusting their own row)", () => {
    expect(shouldWriteGrant("full", "read", true)).toBe(true);
    expect(shouldWriteGrant("read", "read", true)).toBe(true);
  });

  it("SKIPS an equal-role re-grant that comes only from a default (no explicit row)", () => {
    expect(shouldWriteGrant("read", "read", false)).toBe(false);
  });
});
