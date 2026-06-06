import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import {
  DatabasesController,
  PageConvertController,
  PropertiesController,
  RowsController,
  ViewsController,
  WorkspaceDatabasesController,
} from "./databases.controller";
import { DatabaseAccessService } from "./database-access.service";
import {
  DatabaseEventsService,
  NoopDatabaseEventsService,
} from "./database-events.service";
import { DatabasesService } from "./databases.service";
import { PropertiesService } from "./properties.service";
import { ViewsService } from "./views.service";
import { RowsService } from "./rows.service";
import { QueryService } from "./query.service";

/**
 * Phase 5 databases (collections): database/property/view/row/cell/relation CRUD
 * and the rows-query pipeline. Authz is centralised in {@link DatabaseAccessService}
 * (reusing the shared `resolvePageAccess`). Mutations emit through
 * {@link DatabaseEventsService}; the default binding is a no-op that T4 replaces
 * with the realtime gateway.
 */
@Module({
  imports: [WorkspacesModule],
  controllers: [
    WorkspaceDatabasesController,
    DatabasesController,
    PropertiesController,
    ViewsController,
    RowsController,
    PageConvertController,
  ],
  providers: [
    DatabaseAccessService,
    DatabasesService,
    PropertiesService,
    ViewsService,
    RowsService,
    QueryService,
    { provide: DatabaseEventsService, useClass: NoopDatabaseEventsService },
  ],
  exports: [DatabaseEventsService, DatabaseAccessService],
})
export class DatabasesModule {}
