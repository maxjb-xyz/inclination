import { Module } from "@nestjs/common";
import { InvitationsController } from "./invitations.controller";
import { InvitationsService } from "./invitations.service";
import { WorkspacesController } from "./workspaces.controller";
import { WorkspacesService } from "./workspaces.service";

@Module({
  controllers: [WorkspacesController, InvitationsController],
  providers: [WorkspacesService, InvitationsService],
  exports: [WorkspacesService, InvitationsService],
})
export class WorkspacesModule {}
