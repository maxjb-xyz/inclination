import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import { updateProfileSchema, type UpdateProfileInput } from "@inclination/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { PublicUser } from "../common/public-user";
import { UsersService } from "./users.service";

@Controller("users")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get("me")
  me(@CurrentUser() user: PublicUser): PublicUser {
    return user;
  }

  @Patch("me")
  update(
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput,
  ): Promise<PublicUser> {
    return this.users.updateProfile(user.id, body);
  }
}
