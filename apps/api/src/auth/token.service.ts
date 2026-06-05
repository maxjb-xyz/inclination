import { createHash, randomBytes } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { User } from "@inclination/db";
import { AppConfig } from "../config/app-config";
import { PrismaService } from "../prisma/prisma.service";

export interface AccessClaims {
  sub: string;
  email: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Issues short-lived access JWTs and DB-backed, rotating refresh tokens.
 * Refresh tokens are random high-entropy secrets stored only as SHA-256 hashes.
 * Presenting an already-rotated (revoked) refresh token is treated as theft:
 * the entire token chain for that user is revoked.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  issueAccess(user: Pick<User, "id" | "email">): string {
    const claims: AccessClaims = { sub: user.id, email: user.email };
    return this.jwt.sign(claims);
  }

  verifyAccess(token: string): AccessClaims {
    try {
      return this.jwt.verify<AccessClaims>(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired access token");
    }
  }

  private hashToken(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }

  /** Mint a new refresh token for a user and persist its hash. */
  async issueRefresh(userId: string): Promise<string> {
    const raw = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.config.refreshTtlSec * 1000);
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: this.hashToken(raw), expiresAt },
    });
    return raw;
  }

  /** Issue both tokens for a freshly-authenticated user. */
  async issuePair(user: Pick<User, "id" | "email">): Promise<TokenPair> {
    return {
      accessToken: this.issueAccess(user),
      refreshToken: await this.issueRefresh(user.id),
    };
  }

  /**
   * Validate a presented refresh token and rotate it. Returns a new pair.
   * Reuse of a revoked token revokes every token for that user.
   */
  async rotate(presented: string): Promise<TokenPair> {
    const tokenHash = this.hashToken(presented);
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!record) {
      throw new UnauthorizedException("Invalid refresh token");
    }
    if (record.revokedAt) {
      // Token reuse — likely theft. Revoke the whole chain.
      await this.revokeAll(record.userId);
      throw new UnauthorizedException("Refresh token already used");
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException("Refresh token expired");
    }

    const user = await this.prisma.user.findUnique({ where: { id: record.userId } });
    if (!user) {
      throw new UnauthorizedException("User no longer exists");
    }

    const newRaw = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.config.refreshTtlSec * 1000);
    const replacement = await this.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: this.hashToken(newRaw), expiresAt },
    });
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date(), replacedById: replacement.id },
    });

    return { accessToken: this.issueAccess(user), refreshToken: newRaw };
  }

  /** Logout: revoke a single presented refresh token (idempotent). */
  async revoke(presented: string): Promise<void> {
    const tokenHash = this.hashToken(presented);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revoke every active refresh token for a user. */
  async revokeAll(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
