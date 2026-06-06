import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";
import { SearchIndexService } from "./search-index.service";

/**
 * Search feature (spec §6): the read API (full-text query) plus the index
 * maintenance the API owns (page title on rename, database cell text on row
 * pages). {@link SearchIndexService} is exported so PagesModule / DatabasesModule
 * can keep the index current after their mutations.
 */
@Module({
  imports: [WorkspacesModule],
  controllers: [SearchController],
  providers: [SearchService, SearchIndexService],
  exports: [SearchIndexService],
})
export class SearchModule {}
