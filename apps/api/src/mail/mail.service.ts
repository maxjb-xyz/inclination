import { Inject, Injectable } from "@nestjs/common";
import { AppConfig } from "../config/app-config";
import { MAIL_TRANSPORT, type MailTransport } from "./transports";

@Injectable()
export class MailService {
  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    private readonly config: AppConfig,
  ) {}

  async sendVerificationEmail(to: string, token: string): Promise<void> {
    const link = `${this.config.appBaseUrl}/verify-email?token=${encodeURIComponent(token)}`;
    await this.transport.send({
      to,
      subject: "Verify your Inclination email",
      text: `Welcome to Inclination! Confirm your email by visiting:\n\n${link}\n\nThis link expires soon.`,
    });
  }

  async sendPasswordResetEmail(to: string, token: string): Promise<void> {
    const link = `${this.config.appBaseUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await this.transport.send({
      to,
      subject: "Reset your Inclination password",
      text: `Reset your password by visiting:\n\n${link}\n\nIf you didn't request this, ignore this email.`,
    });
  }

  async sendInvitationEmail(to: string, token: string, workspaceName: string): Promise<void> {
    const link = `${this.config.appBaseUrl}/accept-invite?token=${encodeURIComponent(token)}`;
    await this.transport.send({
      to,
      subject: `You're invited to the "${workspaceName}" workspace`,
      text: `You've been invited to join "${workspaceName}" on Inclination. Accept here:\n\n${link}`,
    });
  }
}
