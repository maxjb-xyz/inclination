import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { acceptInvitationSchema, type AcceptInvitationInput } from "@inclination/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { PublicUser } from "../common/public-user";
import { InvitationsService } from "./invitations.service";

@Controller("invitations")
@UseGuards(JwtAuthGuard)
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post("accept")
  @HttpCode(200)
  accept(
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(acceptInvitationSchema)) body: AcceptInvitationInput,
  ) {
    return this.invitations.accept(user.id, user.email, body.token);
  }
}
