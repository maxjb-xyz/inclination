import { create } from "zustand";
import { persist } from "zustand/middleware";

/** User-selectable theme preference. `system` follows the OS color scheme. */
export type ThemePreference = "light" | "dark" | "system";

/** A concrete, resolved theme actually applied to the document. */
export type ResolvedTheme = "light" | "dark";

interface ThemeState {
  /** The user's chosen preference (persisted). */
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
  /** Cycle light → dark → system → light (used by the toggle control + shortcut). */
  cycle: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      preference: "system",
      setPreference: (preference) => set({ preference }),
      cycle: () =>
        set((s) => ({
          preference:
            s.preference === "light" ? "dark" : s.preference === "dark" ? "system" : "light",
        })),
    }),
    { name: "inclination-theme" },
  ),
);

/** Returns true when the OS currently prefers a dark color scheme. */
export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Resolve a preference to the concrete theme to apply right now. */
export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") return systemPrefersDark() ? "dark" : "light";
  return preference;
}
