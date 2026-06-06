import { expect, type APIRequestContext } from "@playwright/test";

/**
 * Shared e2e helpers: Mailpit one-time-token extraction and the
 * register → verify → login flow used to seed authenticated sessions against
 * the real running stack (Caddy → API → Postgres + Mailpit).
 */

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

/** Reads a one-time token of the given kind from the latest matching Mailpit message. */
export async function tokenFromMail(
  ctx: APIRequestContext,
  email: string,
  kind: "verify-email" | "accept-invite" | "reset-password",
): Promise<string> {
  const pattern = new RegExp(`${kind}\\?token=([^&\\s]+)`);
  for (let attempt = 0; attempt < 30; attempt++) {
    const list = await ctx.get(`${MAILPIT}/api/v1/messages?limit=100`);
    const { messages } = (await list.json()) as {
      messages: { ID: string; To: { Address: string }[] }[];
    };
    for (const m of messages) {
      if (!m.To.some((t) => t.Address.toLowerCase() === email.toLowerCase())) continue;
      const detail = (await (await ctx.get(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as {
        Text: string;
      };
      const match = detail.Text.match(pattern);
      if (match) return decodeURIComponent(match[1]!);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No ${kind} mail found for ${email}`);
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}
export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
}

/**
 * Registration is rate-limited to 5/min per IP. Retry on 429 with a backoff so
 * the gate is not flaky under contention from the serial suite.
 */
export async function registerWithRetry(
  ctx: APIRequestContext,
  account: { email: string; password: string; displayName: string },
) {
  // The limit is 5/min/IP. The serial suite issues ~5 registrations within one
  // window, so the last test can sit behind a full window. Retry for well over
  // 60s (12 × 8s ≈ 96s) so registration reliably clears the window rather than
  // being flaky purely on rate limiting.
  for (let attempt = 0; attempt < 12; attempt++) {
    const reg = await ctx.post("/api/auth/register", { data: account });
    if (reg.status() === 201) return reg;
    if (reg.status() !== 429) {
      throw new Error(`register failed with status ${reg.status()}`);
    }
    await new Promise((r) => setTimeout(r, 8_000));
  }
  throw new Error("register kept returning 429 after retries");
}

/** Registers, verifies via Mailpit, and logs in; returns the user + tokens. */
export async function registerVerifyLogin(
  ctx: APIRequestContext,
  account: { email: string; password: string; displayName: string },
): Promise<{ user: PublicUser; tokens: Tokens }> {
  const reg = await registerWithRetry(ctx, account);
  expect(reg.status()).toBe(201);

  const verifyToken = await tokenFromMail(ctx, account.email, "verify-email");
  expect(
    (await ctx.post("/api/auth/verify-email", { data: { token: verifyToken } })).status(),
  ).toBe(200);

  const login = await ctx.post("/api/auth/login", { data: account });
  expect(login.status()).toBe(200);
  const body = (await login.json()) as { user: PublicUser; tokens: Tokens };
  return body;
}

export const authHeader = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
