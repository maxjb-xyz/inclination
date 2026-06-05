import { useEffect, useState } from "react";
import { APP_NAME } from "@inclination/shared";

type ApiState = "checking" | "ok" | "error";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

export function App(): React.ReactElement {
  const [apiState, setApiState] = useState<ApiState>("checking");

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/health`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { status?: string }) => {
        if (!cancelled) setApiState(body.status === "ok" ? "ok" : "error");
      })
      .catch(() => {
        if (!cancelled) setApiState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>{APP_NAME}</h1>
      <p>Self-hosted, real-time-collaborative workspace.</p>
      <p>
        API health: <span data-testid="api-status">{apiState}</span>
      </p>
    </main>
  );
}
