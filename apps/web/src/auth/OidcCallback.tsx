import { useEffect, useState } from "react";
import { AlertCircle, Feather } from "lucide-react";
import { Spinner } from "../ui";
import { authClient } from "./authClient";
import { useAuthStore } from "./authStore";

/**
 * Consumes the OIDC callback the API redirects to after a successful SSO login:
 *   /auth/oidc#accessToken=…&refreshToken=…
 *
 * The tokens arrive in the URL *fragment* (never sent to a server). We exchange
 * the access token for the current user via `/auth/me`, store the session, strip
 * the fragment, and the app renders the workspace.
 *
 * Note: the API's callback returns raw JSON (not a redirect) on failure — e.g.
 * "OIDC email is not verified by the provider" — so that error is shown by the
 * browser at the /api URL and never reaches this component. The defensive
 * branches here cover a missing/!ok session only.
 */
export function OidcCallback(): React.ReactElement {
  const setSession = useAuthStore((s) => s.setSession);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const errParam = params.get("error");
    const accessToken = params.get("accessToken");
    const refreshToken = params.get("refreshToken");

    if (errParam) {
      setError(errParam);
      return;
    }
    if (!accessToken || !refreshToken) {
      setError("Single sign-on did not return a session. Please try again.");
      return;
    }

    let cancelled = false;
    authClient
      .me(accessToken)
      .then((user) => {
        if (cancelled) return;
        // Strip the tokens from the URL, then start the session.
        window.history.replaceState(null, "", "/");
        setSession(user, { accessToken, refreshToken });
      })
      .catch(() => {
        if (!cancelled) setError("Could not complete single sign-on. Please try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [setSession]);

  return (
    <main className="auth-shell">
      <div className="auth-shell__glow" aria-hidden="true" />
      <section className="auth__card">
        <header className="auth__brand">
          <span className="auth__mark" aria-hidden="true">
            <Feather size={20} />
          </span>
        </header>
        {error ? (
          <div className="auth__success" role="alert">
            <span className="auth__success-icon auth__success-icon--error">
              <AlertCircle size={22} />
            </span>
            <p className="auth__success-title">Single sign-on failed</p>
            <p className="auth__success-sub">{error}</p>
          </div>
        ) : (
          <div className="auth__success" role="status">
            <span className="auth__success-icon">
              <Spinner size={22} />
            </span>
            <p className="auth__success-title">Signing you in…</p>
          </div>
        )}
        {error ? (
          <a className="auth__sso" href="/">
            Back to sign in
          </a>
        ) : null}
      </section>
    </main>
  );
}
