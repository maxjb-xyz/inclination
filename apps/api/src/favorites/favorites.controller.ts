import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { reorderFavoritesSchema, type ReorderFavoritesInput } from "@inclination/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { PublicUser } from "../common/public-user";
import { FavoritesService } from "./favorites.service";

/**
 * Phase 9 — favorites & recents (spec §5). All endpoints are JWT-guarded and
 * scoped to the caller; per-page add/visit are read-access-gated in the service
 * (resolvePageAccess). Endpoints:
 *   GET    /favorites              — my favorites (title/icon)
 *   POST   /favorites/reorder      — set the manual order
 *   GET    /recents                — my recently-visited pages
 *   POST   /pages/:id/favorite     — favorite a page
 *   DELETE /pages/:id/favorite     — unfavorite a page
 *   POST   /pages/:id/visit        — record a visit
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get("favorites")
  list(@CurrentUser() user: PublicUser) {
    return this.favorites.listFavorites(user.id);
  }

  @Post("favorites/reorder")
  @HttpCode(200)
  reorder(
    @CurrentUser() user: PublicUser,
    @Body(new ZodValidationPipe(reorderFavoritesSchema)) body: ReorderFavoritesInput,
  ) {
    return this.favorites.reorder(user.id, body);
  }

  @Get("recents")
  recents(@CurrentUser() user: PublicUser) {
    return this.favorites.listRecents(user.id);
  }

  @Post("pages/:id/favorite")
  @HttpCode(200)
  favorite(@CurrentUser() user: PublicUser, @Param("id") pageId: string) {
    return this.favorites.addFavorite(user.id, pageId);
  }

  @Delete("pages/:id/favorite")
  @HttpCode(200)
  unfavorite(@CurrentUser() user: PublicUser, @Param("id") pageId: string) {
    return this.favorites.removeFavorite(user.id, pageId);
  }

  @Post("pages/:id/visit")
  @HttpCode(200)
  visit(@CurrentUser() user: PublicUser, @Param("id") pageId: string) {
    return this.favorites.recordVisit(user.id, pageId);
  }
}
