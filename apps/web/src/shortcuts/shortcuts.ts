/**
 * A small keyboard-shortcut registry. Each shortcut declares a key combo and a
 * `global` flag: global shortcuts (like ⌘K) fire even when typing in an editor
 * or input; non-global ones are suppressed while focus is in an editable
 * surface so they don't hijack normal typing.
 */
export interface Shortcut {
  id: string;
  /** Lower-cased KeyboardEvent.key, e.g. "k", "\\", "l". */
  key: string;
  meta?: boolean; // ⌘ on macOS / Ctrl on others (we accept either)
  shift?: boolean;
  alt?: boolean;
  /** When true, fires even inside the ProseMirror editor / inputs. */
  global?: boolean;
  /** Human-readable description for the shortcuts help list. */
  description: string;
  run: () => void;
}

/**
 * True when the event target is an editable surface (input, textarea,
 * contenteditable — which includes the ProseMirror editor body).
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  // ProseMirror roots carry the `.ProseMirror` class even if isContentEditable
  // is not surfaced on the exact target in some jsdom paths.
  if (typeof el.closest === "function" && el.closest(".ProseMirror")) return true;
  return false;
}

/** Does this keyboard event match the given shortcut's combo? */
export function matchesShortcut(e: KeyboardEvent, s: Shortcut): boolean {
  if (e.key.toLowerCase() !== s.key.toLowerCase()) return false;
  const wantMeta = Boolean(s.meta);
  // Accept either Cmd (mac) or Ctrl (win/linux) for "meta" shortcuts.
  if (wantMeta !== (e.metaKey || e.ctrlKey)) return false;
  if (Boolean(s.shift) !== e.shiftKey) return false;
  if (Boolean(s.alt) !== e.altKey) return false;
  return true;
}

/**
 * Resolves the first matching shortcut for an event, honoring editable-target
 * suppression for non-global shortcuts. Returns the shortcut to run, or null.
 * Pure + side-effect-free so it can be unit-tested directly.
 */
export function resolveShortcut(e: KeyboardEvent, shortcuts: Shortcut[]): Shortcut | null {
  const inEditable = isEditableTarget(e.target);
  for (const s of shortcuts) {
    if (!matchesShortcut(e, s)) continue;
    if (inEditable && !s.global) continue;
    return s;
  }
  return null;
}
