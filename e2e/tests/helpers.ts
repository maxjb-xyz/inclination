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
/**
 * POST an auth endpoint, retrying on 429 with a backoff. The auth routes are
 * rate-limited (5/min/IP) and the serial suite issues several auth calls within
 * one window, so any single call can sit behind a full window. Retrying for
 * well over 60s (12 × 8s ≈ 96s) clears the window rather than being flaky purely
 * on rate limiting. `okStatus` is the success code to accept (201 register, 200
 * verify/login).
 */
export async function postAuthWithRetry(
  ctx: APIRequestContext,
  path: string,
  data: unknown,
  okStatus: number,
  label: string,
) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const res = await ctx.post(path, { data });
    if (res.status() === okStatus) return res;
    if (res.status() !== 429) {
      throw new Error(`${label} failed with status ${res.status()}`);
    }
    await new Promise((r) => setTimeout(r, 8_000));
  }
  throw new Error(`${label} kept returning 429 after retries`);
}

export async function registerWithRetry(
  ctx: APIRequestContext,
  account: { email: string; password: string; displayName: string },
) {
  return postAuthWithRetry(ctx, "/api/auth/register", account, 201, "register");
}

/** Registers, verifies via Mailpit, and logs in; returns the user + tokens. */
export async function registerVerifyLogin(
  ctx: APIRequestContext,
  account: { email: string; password: string; displayName: string },
): Promise<{ user: PublicUser; tokens: Tokens }> {
  const reg = await registerWithRetry(ctx, account);
  expect(reg.status()).toBe(201);

  const verifyToken = await tokenFromMail(ctx, account.email, "verify-email");
  // verify-email and login share the auth rate limiter (5/min/IP); the serial
  // suite can exhaust the window, so retry these on 429 the same way register
  // does rather than failing the gate on a transient limit.
  await postAuthWithRetry(
    ctx,
    "/api/auth/verify-email",
    { token: verifyToken },
    200,
    "verify-email",
  );

  const login = await postAuthWithRetry(ctx, "/api/auth/login", account, 200, "login");
  const body = (await login.json()) as { user: PublicUser; tokens: Tokens };
  return body;
}

export const authHeader = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
