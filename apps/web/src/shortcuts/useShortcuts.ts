import { useEffect, useRef } from "react";
import { resolveShortcut, type Shortcut } from "./shortcuts";

/**
 * Installs a single window-level keydown listener that dispatches to the given
 * shortcuts. Non-global shortcuts are suppressed while focus is in an editable
 * surface (so editor typing is never hijacked). The listener is reinstalled
 * cheaply via a ref so callers can pass an inline array without re-binding.
 */
export function useShortcuts(shortcuts: Shortcut[]): void {
  const ref = useRef(shortcuts);
  ref.current = shortcuts;

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const hit = resolveShortcut(e, ref.current);
      if (hit) {
        e.preventDefault();
        hit.run();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
