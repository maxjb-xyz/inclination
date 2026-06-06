import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { PagesController, WorkspacePagesController } from "./pages.controller";
import { PagesService } from "./pages.service";

@Module({
  imports: [WorkspacesModule],
  controllers: [WorkspacePagesController, PagesController],
  providers: [PagesService],
  exports: [PagesService],
})
export class PagesModule {}
