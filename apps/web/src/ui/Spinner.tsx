import { Loader2 } from "lucide-react";

export function Spinner({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}): React.ReactElement {
  return (
    <Loader2
      size={size}
      className={["ui-spinner", className ?? ""].filter(Boolean).join(" ")}
      aria-hidden="true"
    />
  );
}
