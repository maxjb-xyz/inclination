import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { PublicUser } from "../common/public-user";

/** Injects the authenticated user (populated by JwtAuthGuard). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PublicUser => {
    const request = ctx.switchToHttp().getRequest<{ user: PublicUser }>();
    return request.user;
  },
);
