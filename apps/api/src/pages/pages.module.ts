import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { SearchModule } from "../search/search.module";
import { PagesController, WorkspacePagesController } from "./pages.controller";
import { PagesService } from "./pages.service";

@Module({
  imports: [WorkspacesModule, SearchModule],
  controllers: [WorkspacePagesController, PagesController],
  providers: [PagesService],
  exports: [PagesService],
})
export class PagesModule {}
