import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import jwt from "jsonwebtoken";
import { JwksClient } from "jwks-rsa";
import { AppConfig } from "../config/app-config";
import { PrismaService } from "../prisma/prisma.service";
import { toPublicUser, type PublicUser } from "../common/public-user";
import { TokenService, type TokenPair } from "./token.service";

interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface IdTokenClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  iss: string;
}

@Injectable()
export class OidcService {
  private discovery?: DiscoveryDocument;
  private jwks?: JwksClient;

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly jwt: JwtService,
  ) {}

  private ensureEnabled(): void {
    if (!this.config.oidcEnabled) {
      throw new BadRequestException("OIDC is not configured");
    }
  }

  private async getDiscovery(): Promise<DiscoveryDocument> {
    if (this.discovery) return this.discovery;
    const url = `${this.config.oidcIssuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new ServiceUnavailableException("OIDC discovery failed");
    }
    this.discovery = (await res.json()) as DiscoveryDocument;
    this.jwks = new JwksClient({ jwksUri: this.discovery.jwks_uri });
    return this.discovery;
  }

  /** Build the provider authorization URL with a signed (stateless) state. */
  async buildAuthorizationUrl(): Promise<string> {
    this.ensureEnabled();
    const disco = await this.getDiscovery();
    const state = this.jwt.sign({ kind: "oidc_state" }, { expiresIn: 600 });
    const params = new URLSearchParams({
      client_id: this.config.oidcClientId,
      redirect_uri: this.config.oidcRedirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
    });
    return `${disco.authorization_endpoint}?${params.toString()}`;
  }

  private verifyState(state: string): void {
    try {
      const decoded = this.jwt.verify<{ kind?: string }>(state);
      if (decoded.kind !== "oidc_state") throw new Error("bad state");
    } catch {
      throw new UnauthorizedException("Invalid OIDC state");
    }
  }

  private async exchangeCode(code: string, tokenEndpoint: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.oidcRedirectUri,
      client_id: this.config.oidcClientId,
      client_secret: this.config.oidcClientSecret,
    });
    const res = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      throw new UnauthorizedException("OIDC token exchange failed");
    }
    const json = (await res.json()) as { id_token?: string };
    if (!json.id_token) {
      throw new UnauthorizedException("OIDC response missing id_token");
    }
    return json.id_token;
  }

  private async verifyIdToken(idToken: string, issuer: string): Promise<IdTokenClaims> {
    const decodedHeader = jwt.decode(idToken, { complete: true });
    const kid = decodedHeader && typeof decodedHeader !== "string" ? decodedHeader.header.kid : undefined;
    const signingKey = await this.jwks!.getSigningKey(kid);
    const publicKey = signingKey.getPublicKey();
    try {
      return jwt.verify(idToken, publicKey, {
        algorithms: ["RS256"],
        audience: this.config.oidcClientId,
        issuer,
      }) as IdTokenClaims;
    } catch {
      throw new UnauthorizedException("Invalid id_token");
    }
  }

  /** Exchange an authorization code for our own session, upserting the user. */
  async handleCallback(
    code: string,
    state: string,
  ): Promise<{ user: PublicUser; tokens: TokenPair }> {
    this.ensureEnabled();
    this.verifyState(state);
    const disco = await this.getDiscovery();
    const idToken = await this.exchangeCode(code, disco.token_endpoint);
    const claims = await this.verifyIdToken(idToken, disco.issuer);

    if (!claims.email) {
      throw new UnauthorizedException("OIDC provider did not return an email");
    }
    const email = claims.email.toLowerCase();
    const user = await this.upsertUser(disco.issuer, claims.sub, email, claims.name ?? email);
    return { user: toPublicUser(user), tokens: await this.tokens.issuePair(user) };
  }

  private async upsertUser(issuer: string, subject: string, email: string, displayName: string) {
    const byOidc = await this.prisma.user.findUnique({
      where: { oidcIssuer_oidcSubject: { oidcIssuer: issuer, oidcSubject: subject } },
    });
    if (byOidc) {
      return this.prisma.user.update({
        where: { id: byOidc.id },
        data: { email, emailVerifiedAt: byOidc.emailVerifiedAt ?? new Date() },
      });
    }
    const byEmail = await this.prisma.user.findUnique({ where: { email } });
    if (byEmail) {
      // Link the OIDC identity to the existing local account.
      return this.prisma.user.update({
        where: { id: byEmail.id },
        data: {
          oidcIssuer: issuer,
          oidcSubject: subject,
          emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date(),
        },
      });
    }
    return this.prisma.user.create({
      data: {
        email,
        displayName,
        oidcIssuer: issuer,
        oidcSubject: subject,
        emailVerifiedAt: new Date(),
      },
    });
  }
}
