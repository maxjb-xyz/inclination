import { QueryClientProvider } from "@tanstack/react-query";
import { APP_NAME } from "@inclination/shared";
import { AuthPanel } from "./auth/AuthPanel";
import { useAuthStore } from "./auth/authStore";
import { Workspace } from "./pages/Workspace";
import { queryClient } from "./queryClient";
import "./app.css";

export function App(): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);

  if (!user) {
    return (
      <main className="auth-shell">
        <h1>{APP_NAME}</h1>
        <p>Self-hosted, real-time-collaborative workspace.</p>
        <AuthPanel />
      </main>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <div className="app-shell">
        <header className="app-topbar">
          <span className="brand">{APP_NAME}</span>
          <span className="spacer" />
          <span data-testid="current-user">Signed in as {user.displayName}</span>
          <button onClick={clear}>Sign out</button>
        </header>
        <Workspace />
      </div>
    </QueryClientProvider>
  );
}
