import { useEffect, useSyncExternalStore } from "react";
import { resolveTheme, systemPrefersDark, useThemeStore, type ResolvedTheme } from "./themeStore";

/**
 * Applies the resolved theme to the document root as a `data-theme` attribute
 * and keeps it in sync with both the persisted preference and (when the
 * preference is `system`) the OS `prefers-color-scheme` media query.
 *
 * Returns the current preference + resolved theme so the toggle UI can render.
 */
export function useTheme(): {
  preference: ReturnType<typeof useThemeStore.getState>["preference"];
  resolved: ResolvedTheme;
  setPreference: ReturnType<typeof useThemeStore.getState>["setPreference"];
  cycle: ReturnType<typeof useThemeStore.getState>["cycle"];
} {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  const cycle = useThemeStore((s) => s.cycle);

  // Subscribe to the OS color-scheme so `system` reacts live. Returns a stable
  // boolean snapshot; React re-renders when it flips.
  const systemDark = useSyncExternalStore(
    subscribeToSystemScheme,
    () => systemPrefersDark(),
    () => false,
  );

  const resolved: ResolvedTheme =
    preference === "system" ? (systemDark ? "dark" : "light") : preference;

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.setAttribute("data-theme", resolved);
    root.style.colorScheme = resolved;
  }, [resolved]);

  return { preference, resolved, setPreference, cycle };
}

function subscribeToSystemScheme(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  // Older Safari only supports addListener; guard for both.
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }
  mq.addListener(onChange);
  return () => mq.removeListener(onChange);
}

/** Imperatively apply the persisted theme on first paint (before React mounts). */
export function applyInitialTheme(): void {
  if (typeof document === "undefined") return;
  const pref = useThemeStore.getState().preference;
  const resolved = resolveTheme(pref);
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.style.colorScheme = resolved;
}
