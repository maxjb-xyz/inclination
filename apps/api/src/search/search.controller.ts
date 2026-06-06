import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { searchQuerySchema, type SearchQueryInput } from "@inclination/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { PublicUser } from "../common/public-user";
import { SearchService } from "./search.service";

/** Workspace-scoped full-text search (spec §6). */
@Controller("workspaces/:wsId")
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get("search")
  query(
    @CurrentUser() user: PublicUser,
    @Param("wsId") wsId: string,
    @Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQueryInput,
  ) {
    return this.search.search(user.id, wsId, query);
  }
}
