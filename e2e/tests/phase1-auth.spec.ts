import { expect, test } from "@playwright/test";
import { postAuthWithRetry, tokenFromMail } from "./helpers";

/**
 * Phase 1 "Done when" gate, exercised through the real stack (Caddy → API →
 * Postgres) with a Mailpit catcher for the verification / invitation emails:
 * a user registers, verifies, creates a workspace, and invites a member; the
 * invited user registers, verifies, logs in, accepts, and sees the workspace.
 *
 * (OIDC against a test provider is covered at the integration layer with full
 * id_token signature verification — see apps/api/test/auth.integration.spec.ts.)
 *
 * Auth calls go through ./helpers' `postAuthWithRetry`, which retries on 429 so
 * the gate's status assertions reflect real auth behaviour rather than the
 * shared 5/min/IP rate limiter the serial suite contends on.
 */

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

test("register → verify → workspace → invite → second member joins", async ({ request }) => {
  // Several auth calls, each 429-retried under the shared rate limiter; give the
  // backoff room beyond the default 30s budget.
  test.setTimeout(120_000);
  // Start from a clean mailbox.
  await request.delete(`${MAILPIT}/api/v1/messages`);

  const stamp = Date.now();
  const owner = {
    email: `owner-${stamp}@example.com`,
    password: "ownerpassword1",
    displayName: "Owner",
  };
  const invitee = {
    email: `invitee-${stamp}@example.com`,
    password: "inviteepassword1",
    displayName: "Invitee",
  };

  // Owner registers and is unverified.
  const reg = await postAuthWithRetry(request, "/api/auth/register", owner, 201, "register owner");
  expect((await reg.json()).emailVerified).toBe(false);

  // Login is rejected until verification (retry tolerates a transient 429).
  await postAuthWithRetry(request, "/api/auth/login", owner, 401, "login before verify");

  // Verify via the emailed token, then log in.
  const verifyToken = await tokenFromMail(request, owner.email, "verify-email");
  await postAuthWithRetry(
    request,
    "/api/auth/verify-email",
    { token: verifyToken },
    200,
    "verify owner",
  );

  const login = await postAuthWithRetry(request, "/api/auth/login", owner, 200, "login owner");
  const ownerAccess = (await login.json()).tokens.accessToken as string;
  const auth = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });

  // Create a workspace (owner) and invite a member.
  const ws = await request.post("/api/workspaces", { ...auth(ownerAccess), data: { name: "Acme" } });
  expect(ws.status()).toBe(201);
  const workspaceId = (await ws.json()).id as string;

  const invite = await request.post(`/api/workspaces/${workspaceId}/invitations`, {
    ...auth(ownerAccess),
    data: { email: invitee.email, role: "member" },
  });
  expect(invite.status()).toBe(201);
  const inviteToken = await tokenFromMail(request, invitee.email, "accept-invite");

  // Invitee registers, verifies, logs in.
  await postAuthWithRetry(request, "/api/auth/register", invitee, 201, "register invitee");
  const inviteeVerify = await tokenFromMail(request, invitee.email, "verify-email");
  await postAuthWithRetry(
    request,
    "/api/auth/verify-email",
    { token: inviteeVerify },
    200,
    "verify invitee",
  );
  const login2 = await postAuthWithRetry(request, "/api/auth/login", invitee, 200, "login invitee");
  const inviteeAccess = (await login2.json()).tokens.accessToken as string;

  // Accept the invitation and confirm workspace access.
  const accept = await request.post("/api/invitations/accept", {
    ...auth(inviteeAccess),
    data: { token: inviteToken },
  });
  expect(accept.status()).toBe(200);

  const mine = await request.get("/api/workspaces", auth(inviteeAccess));
  const ids = (await mine.json()).map((w: { id: string }) => w.id);
  expect(ids).toContain(workspaceId);
});
