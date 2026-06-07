function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Deterministic warm color from a string, for presence/avatar tinting. */
function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

export function Avatar({
  name,
  color,
  size = 24,
  className,
}: {
  name: string;
  /** Explicit color (e.g. presence color); otherwise derived from the name. */
  color?: string;
  size?: number;
  className?: string;
}): React.ReactElement {
  const hue = hueFor(name);
  const bg = color ?? `hsl(${hue} 52% 48%)`;
  return (
    <span
      className={["ui-avatar", className ?? ""].filter(Boolean).join(" ")}
      style={{
        width: size,
        height: size,
        background: bg,
        fontSize: Math.round(size * 0.42),
      }}
      title={name}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
