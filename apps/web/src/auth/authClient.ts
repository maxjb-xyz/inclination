import type { PublicUser } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(detail.message ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export const authClient = {
  register: (input: { email: string; password: string; displayName: string }) =>
    post<PublicUser>("/auth/register", input),
  verifyEmail: (token: string) => post<{ user: PublicUser }>("/auth/verify-email", { token }),
  login: (input: { email: string; password: string }) =>
    post<{ user: PublicUser; tokens: Tokens }>("/auth/login", input),
  async me(accessToken: string): Promise<PublicUser> {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return (await res.json()) as PublicUser;
  },
};
