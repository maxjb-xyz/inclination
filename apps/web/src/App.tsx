import { QueryClientProvider } from "@tanstack/react-query";
import { Feather } from "lucide-react";
import { APP_NAME } from "@inclination/shared";
import { AuthPanel } from "./auth/AuthPanel";
import { OidcCallback } from "./auth/OidcCallback";
import { UserMenu } from "./auth/UserMenu";
import { useAuthStore } from "./auth/authStore";
import { Workspace } from "./pages/Workspace";
import { PublicPageView } from "./public/PublicPageView";
import { publicSlugFromPath } from "./public/route";
import { queryClient } from "./queryClient";
import { ThemeToggle } from "./theme/ThemeToggle";
import { useTheme } from "./theme/useTheme";
import { ToastProvider } from "./ui";
import "./app.css";

export function App(): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  // Apply + keep the persisted theme in sync (data-theme on <html>). Runs for
  // every render path (auth screen, public page, app shell).
  useTheme();

  // The public page route is served WITHOUT auth — detect it before the auth
  // gate so a logged-out visitor can read a published page. No token is sent.
  const publicSlug =
    typeof window !== "undefined" ? publicSlugFromPath(window.location.pathname) : null;
  if (publicSlug) {
    return <PublicPageView slug={publicSlug} />;
  }

  // OIDC return target: the API redirects here with tokens in the URL fragment
  // after a successful SSO login. Handled before the auth gate (no token yet).
  const isOidcCallback =
    typeof window !== "undefined" && window.location.pathname === "/auth/oidc";
  if (isOidcCallback) {
    return <OidcCallback />;
  }

  if (!user) {
    return (
      <main className="auth-shell">
        <div className="auth-shell__glow" aria-hidden="true" />
        <AuthPanel />
      </main>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <div className="app-shell">
          <header className="app-topbar">
            <span className="brand">
              <span className="brand__mark" aria-hidden="true">
                <Feather size={15} />
              </span>
              {APP_NAME}
            </span>
            <span className="spacer" />
            <ThemeToggle />
            <UserMenu />
          </header>
          <Workspace />
        </div>
      </ToastProvider>
    </QueryClientProvider>
  );
}
