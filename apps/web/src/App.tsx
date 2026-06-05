import { APP_NAME } from "@inclination/shared";
import { AuthPanel } from "./auth/AuthPanel";
import { useAuthStore } from "./auth/authStore";

export function App(): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 480 }}>
      <h1>{APP_NAME}</h1>
      <p>Self-hosted, real-time-collaborative workspace.</p>
      {user ? (
        <section>
          <p data-testid="current-user">Signed in as {user.displayName}</p>
          <button onClick={clear}>Sign out</button>
        </section>
      ) : (
        <AuthPanel />
      )}
    </main>
  );
}
