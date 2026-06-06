import { Module } from "@nestjs/common";
import { FavoritesController } from "./favorites.controller";
import { FavoritesService } from "./favorites.service";

/**
 * Phase 9 — favorites & recents (spec §5). Read-access-gated via the shared
 * `resolvePageAccess` (imported directly from @inclination/db, no extra module).
 */
@Module({
  controllers: [FavoritesController],
  providers: [FavoritesService],
  exports: [FavoritesService],
})
export class FavoritesModule {}
