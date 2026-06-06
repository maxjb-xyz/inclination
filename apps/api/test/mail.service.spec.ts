import { describe, expect, it } from "vitest";
import { AppConfig } from "../src/config/app-config";
import { MailService } from "../src/mail/mail.service";
import { CapturingTransport } from "../src/mail/transports";

function makeService(): { mail: MailService; transport: CapturingTransport } {
  const transport = new CapturingTransport();
  const config = Object.assign(Object.create(AppConfig.prototype), {
    appBaseUrl: "http://localhost:8080",
  }) as AppConfig;
  return { mail: new MailService(transport, config), transport };
}

describe("MailService", () => {
  it("captures a verification email containing a token link", async () => {
    const { mail, transport } = makeService();
    await mail.sendVerificationEmail("user@example.com", "tok-123");
    const msg = transport.lastTo("user@example.com");
    expect(msg).toBeDefined();
    expect(msg!.subject).toMatch(/verify/i);
    expect(msg!.text).toContain("/verify-email?token=tok-123");
  });

  it("captures a password reset email", async () => {
    const { mail, transport } = makeService();
    await mail.sendPasswordResetEmail("user@example.com", "reset-xyz");
    expect(transport.lastTo("user@example.com")!.text).toContain("/reset-password?token=reset-xyz");
  });

  it("captures an invitation email with the workspace name", async () => {
    const { mail, transport } = makeService();
    await mail.sendInvitationEmail("invitee@example.com", "inv-1", "Acme");
    const msg = transport.lastTo("invitee@example.com")!;
    expect(msg.subject).toContain("Acme");
    expect(msg.text).toContain("/accept-invite?token=inv-1");
  });
});
