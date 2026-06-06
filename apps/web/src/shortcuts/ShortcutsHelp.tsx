import type { Shortcut } from "./shortcuts";

/** Render a shortcut's combo as a sequence of <kbd> chips. */
function comboKeys(s: Shortcut): string[] {
  const keys: string[] = [];
  if (s.meta) keys.push("⌘");
  if (s.shift) keys.push("⇧");
  if (s.alt) keys.push("⌥");
  keys.push(s.key === "\\" ? "\\" : s.key.toUpperCase());
  return keys;
}

/** A modal listing the available keyboard shortcuts (opened with "?"). */
export function ShortcutsHelp({
  shortcuts,
  onClose,
}: {
  shortcuts: Shortcut[];
  onClose: () => void;
}): React.ReactElement {
  return (
    <div
      className="shortcuts-help__overlay"
      data-testid="shortcuts-help"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="shortcuts-help">
        <div className="shortcuts-help__header">
          <h2>Keyboard shortcuts</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <ul className="shortcuts-help__list">
          {shortcuts.map((s) => (
            <li key={s.id} className="shortcuts-help__row">
              <span className="shortcuts-help__desc">{s.description}</span>
              <span className="shortcuts-help__combo">
                {comboKeys(s).map((k, i) => (
                  <kbd key={i}>{k}</kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
