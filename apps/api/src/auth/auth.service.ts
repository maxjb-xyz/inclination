import { createHash, randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type {
  LoginInput,
  PasswordResetConfirmInput,
  RegisterInput,
} from "@inclination/shared";
import { AppConfig } from "../config/app-config";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { toPublicUser, type PublicUser } from "../common/public-user";
import { PasswordService } from "./password.service";
import { TokenService, type TokenPair } from "./token.service";

export interface AuthResult {
  user: PublicUser;
  tokens: TokenPair;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    private readonly config: AppConfig,
  ) {}

  private hash(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }

  private newSecret(): string {
    return randomBytes(32).toString("base64url");
  }

  async register(input: RegisterInput): Promise<PublicUser> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ConflictException("An account with that email already exists");
    }
    const passwordHash = await this.passwords.hash(input.password);
    const user = await this.prisma.user.create({
      data: { email: input.email, passwordHash, displayName: input.displayName },
    });

    const rawToken = this.newSecret();
    await this.prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hash(rawToken),
        expiresAt: new Date(Date.now() + this.config.emailTokenTtlSec * 1000),
      },
    });
    await this.mail.sendVerificationEmail(user.email, rawToken);
    return toPublicUser(user);
  }

  async verifyEmail(rawToken: string): Promise<PublicUser> {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: this.hash(rawToken) },
    });
    if (!record || record.consumedAt || record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("Invalid or expired verification token");
    }
    const [user] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      }),
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
    ]);
    return toPublicUser(user);
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    // Uniform failure for unknown user / wrong password / oidc-only account.
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException("Invalid credentials");
    }
    const ok = await this.passwords.verify(user.passwordHash, input.password);
    if (!ok) {
      throw new UnauthorizedException("Invalid credentials");
    }
    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException("Please verify your email before signing in");
    }
    return { user: toPublicUser(user), tokens: await this.tokens.issuePair(user) };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    return this.tokens.rotate(refreshToken);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.revoke(refreshToken);
  }

  /** Always resolves (does not reveal whether the email exists). */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) return;
    const rawToken = this.newSecret();
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hash(rawToken),
        expiresAt: new Date(Date.now() + this.config.resetTokenTtlSec * 1000),
      },
    });
    await this.mail.sendPasswordResetEmail(user.email, rawToken);
  }

  async resetPassword(input: PasswordResetConfirmInput): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hash(input.token) },
    });
    if (!record || record.consumedAt || record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("Invalid or expired reset token");
    }
    const passwordHash = await this.passwords.hash(input.password);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
    ]);
    // Invalidate existing sessions after a password change.
    await this.tokens.revokeAll(record.userId);
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return toPublicUser(user);
  }
}
