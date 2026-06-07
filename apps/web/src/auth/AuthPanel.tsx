import { useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, Feather, MailCheck } from "lucide-react";
import { APP_NAME, loginSchema, registerSchema } from "@inclination/shared";
import { Button, Field, IconButton, Input, Segmented } from "../ui";
import { authClient } from "./authClient";
import { useAuthStore } from "./authStore";

function PasswordReveal({
  shown,
  onToggle,
}: {
  shown: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <IconButton
      label={shown ? "Hide password" : "Show password"}
      size="sm"
      onClick={onToggle}
      tabIndex={-1}
    >
      {shown ? <EyeOff size={15} /> : <Eye size={15} />}
    </IconButton>
  );
}

export function RegisterForm(): React.ReactElement {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const parsed = registerSchema.safeParse({ email, displayName, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setBusy(true);
    try {
      await authClient.register(parsed.data);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="auth__success" role="status">
        <span className="auth__success-icon">
          <MailCheck size={22} />
        </span>
        <p className="auth__success-title">Check your email to verify your account.</p>
        <p className="auth__success-sub">
          We sent a verification link to <strong>{email}</strong>.
        </p>
      </div>
    );
  }

  return (
    <form className="auth__form" onSubmit={onSubmit} aria-label="Register">
      <Field label="Email">
        <Input
          aria-label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label="Display name">
        <Input
          aria-label="Display name"
          autoComplete="name"
          placeholder="Ada Lovelace"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </Field>
      <Field label="Password" error={error ?? undefined}>
        <Input
          aria-label="Password"
          type={reveal ? "text" : "password"}
          autoComplete="new-password"
          placeholder="At least 10 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          trailing={<PasswordReveal shown={reveal} onToggle={() => setReveal((v) => !v)} />}
        />
      </Field>
      <Button type="submit" variant="primary" block loading={busy} trailingIcon={<ArrowRight size={16} />}>
        Create account
      </Button>
    </form>
  );
}

export function LoginForm(): React.ReactElement {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);
  const setSession = useAuthStore((s) => s.setSession);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError("Enter your email and password");
      return;
    }
    setBusy(true);
    try {
      const { user, tokens } = await authClient.login(parsed.data);
      setSession(user, tokens);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth__form" onSubmit={onSubmit} aria-label="Log in">
      <Field label="Email">
        <Input
          aria-label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label="Password" error={error ?? undefined}>
        <Input
          aria-label="Password"
          type={reveal ? "text" : "password"}
          autoComplete="current-password"
          placeholder="••••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          trailing={<PasswordReveal shown={reveal} onToggle={() => setReveal((v) => !v)} />}
        />
      </Field>
      <Button type="submit" variant="primary" block loading={busy} trailingIcon={<ArrowRight size={16} />}>
        Sign in
      </Button>
    </form>
  );
}

export function AuthPanel(): React.ReactElement {
  const [mode, setMode] = useState<"login" | "register">("login");
  return (
    <section className="auth__card">
      <header className="auth__brand">
        <span className="auth__mark" aria-hidden="true">
          <Feather size={20} />
        </span>
        <h1 className="auth__name">{APP_NAME}</h1>
        <p className="auth__tagline">Your self-hosted workspace</p>
      </header>

      <Segmented
        ariaLabel="Authentication mode"
        className="auth__tabs"
        value={mode}
        onChange={(v) => setMode(v as "login" | "register")}
        items={[
          { value: "login", label: "Log in" },
          { value: "register", label: "Register" },
        ]}
      />

      {mode === "login" ? <LoginForm /> : <RegisterForm />}

      {/* Only shown when the deploy enables OIDC (VITE_OIDC_ENABLED=true at
          build time). A runtime probe is avoided so the auth screen never
          fetches on mount. A full-page nav hands off to the API's OIDC start. */}
      {import.meta.env.VITE_OIDC_ENABLED === "true" ? (
        <a className="auth__sso" href="/api/auth/oidc/login">
          Continue with SSO
        </a>
      ) : null}

      <footer className="auth__footer">Self-hosted · open source</footer>
    </section>
  );
}
