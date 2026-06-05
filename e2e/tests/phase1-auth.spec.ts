import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * Phase 1 "Done when" gate, exercised through the real stack (Caddy → API →
 * Postgres) with a Mailpit catcher for the verification / invitation emails:
 * a user registers, verifies, creates a workspace, and invites a member; the
 * invited user registers, verifies, logs in, accepts, and sees the workspace.
 *
 * (OIDC against a test provider is covered at the integration layer with full
 * id_token signature verification — see apps/api/test/auth.integration.spec.ts.)
 */

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

async function tokenFromMail(
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

test("register → verify → workspace → invite → second member joins", async ({ request }) => {
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
  const reg = await request.post("/api/auth/register", { data: owner });
  expect(reg.status()).toBe(201);
  expect((await reg.json()).emailVerified).toBe(false);

  // Login is rejected until verification.
  expect((await request.post("/api/auth/login", { data: owner })).status()).toBe(401);

  // Verify via the emailed token, then log in.
  const verifyToken = await tokenFromMail(request, owner.email, "verify-email");
  expect((await request.post("/api/auth/verify-email", { data: { token: verifyToken } })).status()).toBe(200);

  const login = await request.post("/api/auth/login", { data: owner });
  expect(login.status()).toBe(200);
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
  await request.post("/api/auth/register", { data: invitee });
  const inviteeVerify = await tokenFromMail(request, invitee.email, "verify-email");
  await request.post("/api/auth/verify-email", { data: { token: inviteeVerify } });
  const login2 = await request.post("/api/auth/login", { data: invitee });
  expect(login2.status()).toBe(200);
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
