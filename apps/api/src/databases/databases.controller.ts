import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import {
  createDatabaseSchema,
  createPropertySchema,
  createRowSchema,
  createViewSchema,
  queryRowsSchema,
  relationLinkSchema,
  reorderPropertiesSchema,
  setCellBodySchema,
  updateDatabaseSchema,
  updatePropertySchema,
  updateViewSchema,
  type CreateDatabaseInput,
  type CreatePropertyInput,
  type CreateRowInput,
  type CreateViewInput,
  type QueryRowsInput,
  type RelationLinkInput,
  type ReorderPropertiesInput,
  type SetCellBodyInput,
  type UpdateDatabaseInput,
  type UpdatePropertyInput,
  type UpdateViewInput,
} from "@inclination/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { PublicUser } from "../common/public-user";
import { DatabasesService } from "./databases.service";
import { PropertiesService } from "./properties.service";
import { ViewsService } from "./views.service";
import { RowsService } from "./rows.service";
import { QueryService } from "./query.service";

/** Create a database under a workspace. */
@Controller("workspaces/:wsId/databases")
@UseGuards(JwtAuthGuard)
export class WorkspaceDatabasesController {
  constructor(private readonly databases: DatabasesService) {}

  @Post()
  create(
    @CurrentUser() user: PublicUser,
    @Param("wsId") wsId: string,
    @Body(new ZodValidationPipe(createDatabaseSchema)) body: CreateDatabaseInput,
  ) {
    return this.databases.create(user.id, wsId, body);
  }
}

/** Database-scoped endpoints: get/update, properties, views, rows, query. */
@Controller("databases/:id")
@UseGuards(JwtAuthGuard)
export class DatabasesController {
  constructor(
    private readonly databases: DatabasesService,
    private readonly properties: PropertiesService,
    private readonly views: ViewsService,
    private readonly rows: RowsService,
    private readonly queries: QueryService,
  ) {}

  @Get()
  get(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.databases.get(user.id, id);
  }

  @Patch()
  update(
    @CurrentUser() user: PublicUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateDatabaseSchema)) body: UpdateDatabaseInput,
  ) {
    return this.databases.update(user.id, id, body);
  }

  @Post("properties")
  createProperty(
    @CurrentUser() user: PublicUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createPropertySchema)) body: CreatePropertyInput,
  ) {
    return this.properties.create(user.id, id, body);
  }

  @Post("properties/reorder")
  reorderProperties(
    @CurrentUser() user: PublicUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(reorderPropertiesSchema)) body: ReorderPropertiesInput,
  ) {
    return this.properties.reorder(user.id, id, body);
  }

  @Post("views")
  createView(
    @CurrentUser() user: PublicUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createViewSchema)) body: CreateViewInput,
  ) {
    return this.views.create(user.id, id, body);
  }

  @Post("rows")
  createRow(
    @CurrentUser() user: PublicUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createRowSchema)) body: CreateRowInput,
  ) {
    return this.rows.create(user.id, id, body);
  }

  @Get("rows")
  listRows(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.rows.list(user.id, id);
  }

  @Post("query")
  query(
    @CurrentUser() user: PublicUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(queryRowsSchema)) body: QueryRowsInput,
  ) {
    return this.queries.query(user.id, id, {
      viewId: body.viewId,
      config: body.config,
      cursor: body.cursor,
      limit: body.limit,
    });
  }
}

/** Property-scoped endpoints. */
@Controller("properties/:id")
@UseGuards(JwtAuthGuard)
export class PropertiesController {
  constructor(
    private readonly properties: PropertiesService,
    private readonly rows: RowsService,
  ) {}

  @Patch()
  update(
    @CurrentUser() user: PublicUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePropertySchema)) body: UpdatePropertyInput,
  ) {
    return this.properties.update(user.id, id, body);
  }

  @Delete()
  remove(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.properties.remove(user.id, id);
  }

  @Post("links")
  link(
    @CurrentUser() user: PublicUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(relationLinkSchema)) body: RelationLinkInput,
  ) {
    return this.rows.link(user.id, id, body);
  }

  @Delete("links")
  unlink(
    @CurrentUser() user: PublicUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(relationLinkSchema)) body: RelationLinkInput,
  ) {
    return this.rows.unlink(user.id, id, body);
  }
}

/** View-scoped endpoints. */
@Controller("views/:id")
@UseGuards(JwtAuthGuard)
export class ViewsController {
  constructor(private readonly views: ViewsService) {}

  @Patch()
  update(
    @CurrentUser() user: PublicUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateViewSchema)) body: UpdateViewInput,
  ) {
    return this.views.update(user.id, id, body);
  }

  @Delete()
  remove(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.views.remove(user.id, id);
  }

  @Post("default")
  setDefault(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.views.setDefault(user.id, id);
  }
}

/** Row-scoped cell endpoint. */
@Controller("rows/:rowId")
@UseGuards(JwtAuthGuard)
export class RowsController {
  constructor(private readonly rows: RowsService) {}

  @Put("cells/:propertyId")
  setCell(
    @CurrentUser() user: PublicUser,
    @Param("rowId") rowId: string,
    @Param("propertyId") propertyId: string,
    @Body(new ZodValidationPipe(setCellBodySchema)) body: SetCellBodyInput,
  ) {
    // The propertyId comes from the path; merge it so the service sees one shape.
    return this.rows.setCell(user.id, rowId, { propertyId, value: body.value });
  }
}

/** Convert an existing page into a database. */
@Controller("pages/:id")
@UseGuards(JwtAuthGuard)
export class PageConvertController {
  constructor(private readonly databases: DatabasesService) {}

  @Post("convert-to-database")
  convert(@CurrentUser() user: PublicUser, @Param("id") id: string) {
    return this.databases.convert(user.id, id);
  }
}
