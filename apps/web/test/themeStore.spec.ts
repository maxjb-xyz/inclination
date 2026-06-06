import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTheme, systemPrefersDark, useThemeStore } from "../src/theme/themeStore";

/** Install a matchMedia stub that reports the given dark-mode preference. */
function stubMatchMedia(prefersDark: boolean) {
  const mql = {
    matches: prefersDark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mql),
  );
  // jsdom's window.matchMedia must also be stubbed for systemPrefersDark.
  Object.defineProperty(window, "matchMedia", {
    value: () => mql,
    configurable: true,
  });
  return mql;
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

beforeEach(() => {
  useThemeStore.setState({ preference: "system" });
});

describe("themeStore", () => {
  it("defaults to system", () => {
    expect(useThemeStore.getState().preference).toBe("system");
  });

  it("setPreference updates the store", () => {
    useThemeStore.getState().setPreference("dark");
    expect(useThemeStore.getState().preference).toBe("dark");
  });

  it("cycle goes light -> dark -> system -> light", () => {
    useThemeStore.setState({ preference: "light" });
    useThemeStore.getState().cycle();
    expect(useThemeStore.getState().preference).toBe("dark");
    useThemeStore.getState().cycle();
    expect(useThemeStore.getState().preference).toBe("system");
    useThemeStore.getState().cycle();
    expect(useThemeStore.getState().preference).toBe("light");
  });

  it("persists the preference to localStorage", () => {
    useThemeStore.getState().setPreference("dark");
    const raw = localStorage.getItem("inclination-theme");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).state.preference).toBe("dark");
  });
});

describe("resolveTheme + systemPrefersDark", () => {
  it("explicit preferences resolve to themselves", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("system resolves to dark when prefers-color-scheme is dark", () => {
    stubMatchMedia(true);
    expect(systemPrefersDark()).toBe(true);
    expect(resolveTheme("system")).toBe("dark");
  });

  it("system resolves to light when prefers-color-scheme is light", () => {
    stubMatchMedia(false);
    expect(systemPrefersDark()).toBe(false);
    expect(resolveTheme("system")).toBe("light");
  });
});
