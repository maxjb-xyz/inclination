import { describe, expect, it } from "vitest";
import {
  computeReferenceDiff,
  filterReferenceTargets,
  type ReferenceCandidate,
} from "../src/pages/references";

const cand = (id: string, workspaceId = "ws1"): ReferenceCandidate => ({ id, workspaceId });

describe("filterReferenceTargets", () => {
  it("drops self-references", () => {
    const out = filterReferenceTargets(["self", "b"], "self", [cand("self"), cand("b")]);
    expect(out).toEqual(["b"]);
  });

  it("drops ids not present among same-workspace candidates (cross-workspace/missing)", () => {
    // 'other' was not returned by the same-workspace lookup → filtered out.
    const out = filterReferenceTargets(["a", "other"], "from", [cand("a")]);
    expect(out).toEqual(["a"]);
  });

  it("dedupes repeated ids preserving first-seen order", () => {
    const out = filterReferenceTargets(["a", "b", "a"], "from", [cand("a"), cand("b")]);
    expect(out).toEqual(["a", "b"]);
  });

  it("returns empty when nothing is valid", () => {
    expect(filterReferenceTargets(["from"], "from", [cand("from")])).toEqual([]);
  });
});

describe("computeReferenceDiff", () => {
  it("computes inserts and deletes to reach the desired set", () => {
    const { toDelete, toInsert } = computeReferenceDiff(["a", "b"], ["b", "c"]);
    expect(toDelete).toEqual(["a"]);
    expect(toInsert).toEqual(["c"]);
  });

  it("is a no-op when sets are equal", () => {
    const { toDelete, toInsert } = computeReferenceDiff(["a", "b"], ["a", "b"]);
    expect(toDelete).toEqual([]);
    expect(toInsert).toEqual([]);
  });

  it("inserts all when current is empty", () => {
    const { toDelete, toInsert } = computeReferenceDiff([], ["a", "b"]);
    expect(toDelete).toEqual([]);
    expect(toInsert).toEqual(["a", "b"]);
  });

  it("deletes all when desired is empty", () => {
    const { toDelete, toInsert } = computeReferenceDiff(["a", "b"], []);
    expect(toDelete).toEqual(["a", "b"]);
    expect(toInsert).toEqual([]);
  });
});
