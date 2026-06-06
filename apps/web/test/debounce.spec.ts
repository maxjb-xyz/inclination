import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounce } from "../src/pages/debounce";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("debounce", () => {
  it("fires once after the wait window with the latest args", () => {
    const fn = vi.fn();
    const d = debounce(fn, 600);

    d("a");
    d("b");
    d("c");
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(600);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("c");
  });

  it("flush runs a pending call immediately", () => {
    const fn = vi.fn();
    const d = debounce(fn, 600);
    d("x");
    d.flush();
    expect(fn).toHaveBeenCalledExactlyOnceWith("x");
    vi.advanceTimersByTime(600);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancel discards a pending call", () => {
    const fn = vi.fn();
    const d = debounce(fn, 600);
    d("x");
    d.cancel();
    vi.advanceTimersByTime(600);
    expect(fn).not.toHaveBeenCalled();
  });
});
