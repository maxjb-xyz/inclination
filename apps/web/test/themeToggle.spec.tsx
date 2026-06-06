import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "../src/theme/ThemeToggle";
import { useTheme } from "../src/theme/useTheme";
import { useThemeStore } from "../src/theme/themeStore";

function stubMatchMedia(prefersDark: boolean) {
  const mql = {
    matches: prefersDark,
    media: "",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  };
  Object.defineProperty(window, "matchMedia", { value: () => mql, configurable: true });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

beforeEach(() => {
  stubMatchMedia(false);
  useThemeStore.setState({ preference: "system" });
});

/** A tiny harness that mounts the toggle and applies the theme to <html>. */
function Harness() {
  useTheme();
  return <ThemeToggle />;
}

describe("ThemeToggle + useTheme", () => {
  it("applies data-theme to the document root", async () => {
    useThemeStore.setState({ preference: "dark" });
    render(<Harness />);
    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark"),
    );
  });

  it("system preference resolves to light via prefers-color-scheme", async () => {
    stubMatchMedia(false);
    useThemeStore.setState({ preference: "system" });
    render(<Harness />);
    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-theme")).toBe("light"),
    );
    expect(screen.getByTestId("theme-toggle")).toHaveAttribute("data-theme-resolved", "light");
  });

  it("clicking cycles the preference and updates the applied theme", async () => {
    useThemeStore.setState({ preference: "light" });
    const u = userEvent.setup();
    render(<Harness />);

    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-theme")).toBe("light"),
    );
    await u.click(screen.getByTestId("theme-toggle"));
    expect(useThemeStore.getState().preference).toBe("dark");
    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark"),
    );
  });
});
