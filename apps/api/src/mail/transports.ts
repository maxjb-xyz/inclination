import nodemailer from "nodemailer";

export interface SentMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailTransport {
  send(message: SentMessage): Promise<void>;
}

/** DI token for the active mail transport. */
export const MAIL_TRANSPORT = Symbol("MAIL_TRANSPORT");

/**
 * In-memory transport for dev and tests: records every message so tests can
 * read the verification/reset/invite link (and dev can inspect it). Never used
 * when SMTP_URL is configured.
 */
export class CapturingTransport implements MailTransport {
  readonly messages: SentMessage[] = [];

  async send(message: SentMessage): Promise<void> {
    this.messages.push(message);
  }

  /** Most recent message sent to an address (case-insensitive), if any. */
  lastTo(email: string): SentMessage | undefined {
    const target = email.toLowerCase();
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i]!.to.toLowerCase() === target) return this.messages[i];
    }
    return undefined;
  }
}

/** Real SMTP transport via nodemailer (used when SMTP_URL is set). */
export class SmtpTransport implements MailTransport {
  private readonly transporter: nodemailer.Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transporter = nodemailer.createTransport(smtpUrl);
  }

  async send(message: SentMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}
