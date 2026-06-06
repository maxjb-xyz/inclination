import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReferenceSync } from "../src/editor/useReferenceSync";

/** A doc JSON with the given pageLink / page-mention references. */
function docWith(refs: { pageLinks?: string[]; pageMentions?: string[] }) {
  const content = [
    ...(refs.pageLinks ?? []).map((pageId) => ({ type: "pageLink", attrs: { pageId } })),
    ...(refs.pageMentions ?? []).map((id) => ({
      type: "mention",
      attrs: { kind: "page", id },
    })),
  ];
  return { type: "doc", content: [{ type: "paragraph", content }] };
}

describe("reference sync", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces, extracts refs, and PUTs the deduped page ids", async () => {
    const doc = docWith({ pageLinks: ["p1", "p1"], pageMentions: ["p2"] });
    const put = vi.fn(async () => ({ count: 2 }));
    const ctrl = createReferenceSync({
      pageId: "self",
      getDoc: () => doc,
      putReferences: put,
      wait: 800,
    });

    ctrl.sync();
    ctrl.sync();
    expect(put).not.toHaveBeenCalled(); // still within the debounce window

    await vi.advanceTimersByTimeAsync(800);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith("self", ["p1", "p2"]);
  });

  it("skips the PUT when the reference set is unchanged from the last sync", async () => {
    const doc = docWith({ pageLinks: ["p1"] });
    const put = vi.fn(async () => ({ count: 1 }));
    const ctrl = createReferenceSync({
      pageId: "self",
      getDoc: () => doc,
      putReferences: put,
      wait: 800,
    });

    ctrl.sync();
    await vi.advanceTimersByTimeAsync(800);
    expect(put).toHaveBeenCalledTimes(1);

    // Same refs again -> no second PUT.
    ctrl.sync();
    await vi.advanceTimersByTimeAsync(800);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("skips the initial unchanged doc when seeded with initialRefs", async () => {
    const doc = docWith({ pageLinks: ["p1"] });
    const put = vi.fn(async () => ({ count: 1 }));
    const ctrl = createReferenceSync({
      pageId: "self",
      getDoc: () => doc,
      putReferences: put,
      wait: 800,
      initialRefs: ["p1"],
    });

    ctrl.sync();
    await vi.advanceTimersByTimeAsync(800);
    expect(put).not.toHaveBeenCalled();
  });

  it("PUTs again after a real change", async () => {
    let doc = docWith({ pageLinks: ["p1"] });
    const put = vi.fn(async () => ({ count: 1 }));
    const ctrl = createReferenceSync({
      pageId: "self",
      getDoc: () => doc,
      putReferences: put,
      wait: 800,
      initialRefs: ["p1"],
    });

    doc = docWith({ pageLinks: ["p1", "p3"] });
    ctrl.sync();
    await vi.advanceTimersByTimeAsync(800);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith("self", ["p1", "p3"]);
  });
});
