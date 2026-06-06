import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { SearchModule } from "../search/search.module";
import {
  DatabasesController,
  PageConvertController,
  PropertiesController,
  RowsController,
  ViewsController,
  WorkspaceDatabasesController,
} from "./databases.controller";
import { DatabaseAccessService } from "./database-access.service";
import { DatabaseEventsService } from "./database-events.service";
import { DatabaseRealtimeGateway } from "./realtime/database-realtime.gateway";
import { DatabasesService } from "./databases.service";
import { PropertiesService } from "./properties.service";
import { ViewsService } from "./views.service";
import { RowsService } from "./rows.service";
import { QueryService } from "./query.service";

/**
 * Phase 5 databases (collections): database/property/view/row/cell/relation CRUD
 * and the rows-query pipeline. Authz is centralised in {@link DatabaseAccessService}
 * (reusing the shared `resolvePageAccess`). Mutations emit through
 * {@link DatabaseEventsService}; the binding is the {@link DatabaseRealtimeGateway}
 * (T4), so every mutation fans out over socket.io to the `database:{id}` room.
 */
@Module({
  imports: [WorkspacesModule, SearchModule],
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
    // The realtime gateway IS the events emitter: T3 services inject
    // DatabaseEventsService and get the gateway, so emit() broadcasts over
    // socket.io. One singleton serves both roles (same instance).
    DatabaseRealtimeGateway,
    { provide: DatabaseEventsService, useExisting: DatabaseRealtimeGateway },
  ],
  exports: [DatabaseEventsService, DatabaseAccessService],
})
export class DatabasesModule {}
