import { useState, type FormEvent } from "react";
import { loginSchema, registerSchema } from "@inclination/shared";
import { authClient } from "./authClient";
import { useAuthStore } from "./authStore";

export function RegisterForm(): React.ReactElement {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const parsed = registerSchema.safeParse({ email, displayName, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    try {
      await authClient.register(parsed.data);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    }
  }

  if (done) {
    return <p role="status">Check your email to verify your account.</p>;
  }

  return (
    <form onSubmit={onSubmit} aria-label="Register">
      <input aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input
        aria-label="Display name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
      />
      <input
        aria-label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p role="alert">{error}</p>}
      <button type="submit">Create account</button>
    </form>
  );
}

export function LoginForm(): React.ReactElement {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const setSession = useAuthStore((s) => s.setSession);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError("Enter your email and password");
      return;
    }
    try {
      const { user, tokens } = await authClient.login(parsed.data);
      setSession(user, tokens);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <form onSubmit={onSubmit} aria-label="Log in">
      <input aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input
        aria-label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p role="alert">{error}</p>}
      <button type="submit">Sign in</button>
    </form>
  );
}

export function AuthPanel(): React.ReactElement {
  const [mode, setMode] = useState<"login" | "register">("login");
  return (
    <section>
      <div role="tablist">
        <button onClick={() => setMode("login")} aria-pressed={mode === "login"}>
          Log in
        </button>
        <button onClick={() => setMode("register")} aria-pressed={mode === "register"}>
          Register
        </button>
      </div>
      {mode === "login" ? <LoginForm /> : <RegisterForm />}
    </section>
  );
}
