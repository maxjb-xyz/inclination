import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut } from "lucide-react";
import { Avatar } from "../ui";
import { useAuthStore } from "./authStore";

/**
 * Topbar account control: avatar + name trigger that opens a small menu with
 * the signed-in identity and a sign-out action.
 *
 * Keeps `data-testid="current-user"` on the (visible) trigger and ensures its
 * text content includes "Signed in as <name>" for the unit + e2e contracts.
 */
export function UserMenu(): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return <span />;

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="user-menu__trigger"
        data-testid="current-user"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar name={user.displayName} size={24} />
        <span className="user-menu__name">{user.displayName}</span>
        <ChevronDown size={14} className="user-menu__chevron" aria-hidden="true" />
        <span className="sr-only">Signed in as {user.displayName}</span>
      </button>
      {open && (
        <div className="user-menu__pop" role="menu">
          <div className="user-menu__id">
            <Avatar name={user.displayName} size={36} />
            <div className="user-menu__id-text">
              <strong>{user.displayName}</strong>
              <span>{user.email}</span>
            </div>
          </div>
          <div className="user-menu__sep" />
          <button
            type="button"
            className="user-menu__item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              clear();
            }}
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
