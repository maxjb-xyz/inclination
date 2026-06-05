import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  loginSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  refreshSchema,
  registerSchema,
  verifyEmailSchema,
  type LoginInput,
  type PasswordResetConfirmInput,
  type PasswordResetRequestInput,
  type RefreshInput,
  type RegisterInput,
  type VerifyEmailInput,
} from "@inclination/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "./current-user.decorator";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { AuthService } from "./auth.service";
import type { PublicUser } from "../common/public-user";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body(new ZodValidationPipe(registerSchema)) body: RegisterInput) {
    return this.auth.register(body);
  }

  @Post("verify-email")
  @HttpCode(200)
  async verifyEmail(@Body(new ZodValidationPipe(verifyEmailSchema)) body: VerifyEmailInput) {
    const user = await this.auth.verifyEmail(body.token);
    return { user };
  }

  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput) {
    return this.auth.login(body);
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(@Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput) {
    const tokens = await this.auth.refresh(body.refreshToken);
    return { tokens };
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }

  @Post("password-reset/request")
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async requestReset(
    @Body(new ZodValidationPipe(passwordResetRequestSchema)) body: PasswordResetRequestInput,
  ): Promise<{ status: "ok" }> {
    await this.auth.requestPasswordReset(body.email);
    return { status: "ok" };
  }

  @Post("password-reset/confirm")
  @HttpCode(204)
  async confirmReset(
    @Body(new ZodValidationPipe(passwordResetConfirmSchema)) body: PasswordResetConfirmInput,
  ): Promise<void> {
    await this.auth.resetPassword(body);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: PublicUser): PublicUser {
    return user;
  }
}
