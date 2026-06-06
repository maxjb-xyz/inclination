import { useTheme } from "./useTheme";

const LABELS: Record<string, { icon: string; text: string }> = {
  light: { icon: "☀️", text: "Light" },
  dark: { icon: "🌙", text: "Dark" },
  system: { icon: "🖥️", text: "System" },
};

/**
 * A compact theme toggle for the topbar. Clicking cycles
 * light → dark → system. The label reflects the chosen preference (not the
 * resolved theme) so the user can tell `system` apart.
 */
export function ThemeToggle(): React.ReactElement {
  const { preference, resolved, cycle } = useTheme();
  const label = LABELS[preference] ?? LABELS.system!;
  return (
    <button
      type="button"
      className="theme-toggle"
      data-testid="theme-toggle"
      data-theme-preference={preference}
      data-theme-resolved={resolved}
      aria-label={`Theme: ${label.text}. Click to change.`}
      title={`Theme: ${label.text}`}
      onClick={cycle}
    >
      <span aria-hidden="true">{label.icon}</span>
      <span className="theme-toggle__text">{label.text}</span>
    </button>
  );
}
