import { Controller, Get, Query, Req, Res } from "@nestjs/common";
import { AppConfig } from "../config/app-config";
import { OidcService } from "./oidc.service";

const TX_COOKIE = "oidc_tx";
const COOKIE_PATH = "/api/auth/oidc";

interface HttpRequest {
  headers: { cookie?: string };
}
interface CookieOptions {
  httpOnly?: boolean;
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
  maxAge?: number;
  path?: string;
}
interface HttpResponse {
  cookie(name: string, value: string, options: CookieOptions): void;
  clearCookie(name: string, options: CookieOptions): void;
  redirect(status: number, url: string): void;
  status(code: number): { json(body: unknown): void };
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

@Controller("auth/oidc")
export class OidcController {
  constructor(
    private readonly oidc: OidcService,
    private readonly config: AppConfig,
  ) {}

  /** Begin OIDC login: set the browser-binding cookie and redirect to the IdP. */
  @Get("login")
  async login(@Res() res: HttpResponse): Promise<void> {
    const { url, txToken } = await this.oidc.beginLogin();
    res.cookie(TX_COOKIE, txToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: this.config.isProduction,
      maxAge: 600_000,
      path: COOKIE_PATH,
    });
    res.redirect(302, url);
  }

  /** Provider redirect target: validate, exchange, and hand the SPA a session. */
  @Get("callback")
  async callback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Req() req: HttpRequest,
    @Res() res: HttpResponse,
  ): Promise<void> {
    if (!code || !state) {
      res.status(400).json({ message: "Missing code or state" });
      return;
    }
    const txToken = readCookie(req.headers.cookie, TX_COOKIE);
    const { tokens } = await this.oidc.handleCallback(code, state, txToken);
    res.clearCookie(TX_COOKIE, { path: COOKIE_PATH });

    // Hand tokens to the SPA via the URL fragment (not the query/body, so they
    // are not sent to servers or stored in navigation logs).
    const fragment = new URLSearchParams({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    }).toString();
    res.redirect(302, `${this.config.appBaseUrl}/auth/oidc#${fragment}`);
  }
}
