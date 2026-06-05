import { Controller, Get, Query, Res } from "@nestjs/common";
import { OidcService } from "./oidc.service";

/** Minimal structural view of the HTTP response (avoids an express type dep). */
interface HttpResponse {
  redirect(status: number, url: string): void;
  status(code: number): { json(body: unknown): void };
}

@Controller("auth/oidc")
export class OidcController {
  constructor(private readonly oidc: OidcService) {}

  /** Begin OIDC login: redirect the browser to the provider. */
  @Get("login")
  async login(@Res() res: HttpResponse): Promise<void> {
    const url = await this.oidc.buildAuthorizationUrl();
    res.redirect(302, url);
  }

  /** Provider redirect target: exchange the code and return a session. */
  @Get("callback")
  async callback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Res() res: HttpResponse,
  ): Promise<void> {
    if (!code || !state) {
      res.status(400).json({ message: "Missing code or state" });
      return;
    }
    const result = await this.oidc.handleCallback(code, state);
    res.status(200).json(result);
  }
}
