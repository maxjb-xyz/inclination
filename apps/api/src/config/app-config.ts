import { Injectable } from "@nestjs/common";
import { envBool, envInt, envOrDefault } from "@inclination/shared";

/**
 * Typed, env-sourced configuration. Field initializers read `process.env` at
 * construction, so integration tests that set env before creating the Nest app
 * get the right values. No secrets are hardcoded for production — dev defaults
 * exist only to keep local/test boots frictionless.
 */
@Injectable()
export class AppConfig {
  /** Public base URL the SPA is served from (used to build email links). */
  readonly appBaseUrl = envOrDefault("APP_BASE_URL", "http://localhost:8080");
  /** Origin allowed by CORS; defaults to the app base URL. */
  readonly corsOrigin = envOrDefault("CORS_ORIGIN", this.appBaseUrlOrDefault());

  readonly jwtAccessSecret = envOrDefault("JWT_ACCESS_SECRET", "dev_access_secret_change_me");
  readonly accessTtlSec = envInt("JWT_ACCESS_TTL", 15 * 60);
  readonly refreshTtlSec = envInt("JWT_REFRESH_TTL", 30 * 24 * 60 * 60);
  readonly emailTokenTtlSec = envInt("EMAIL_TOKEN_TTL", 24 * 60 * 60);
  readonly resetTokenTtlSec = envInt("RESET_TOKEN_TTL", 60 * 60);
  readonly inviteTokenTtlSec = envInt("INVITE_TOKEN_TTL", 7 * 24 * 60 * 60);

  // ── OIDC (generic OpenID Connect) ──
  readonly oidcIssuer = envOrDefault("OIDC_ISSUER", "");
  readonly oidcClientId = envOrDefault("OIDC_CLIENT_ID", "");
  readonly oidcClientSecret = envOrDefault("OIDC_CLIENT_SECRET", "");
  readonly oidcRedirectUri = envOrDefault(
    "OIDC_REDIRECT_URI",
    `${this.appBaseUrlOrDefault()}/api/auth/oidc/callback`,
  );
  get oidcEnabled(): boolean {
    return this.oidcIssuer !== "" && this.oidcClientId !== "";
  }

  // ── Mail ──
  readonly smtpUrl = envOrDefault("SMTP_URL", "");
  readonly mailFrom = envOrDefault("MAIL_FROM", "Inclination <no-reply@localhost>");

  // ── Misc ──
  readonly isTest = envBool("IS_TEST", envOrDefault("NODE_ENV", "") === "test");

  private appBaseUrlOrDefault(): string {
    return envOrDefault("APP_BASE_URL", "http://localhost:8080");
  }
}
