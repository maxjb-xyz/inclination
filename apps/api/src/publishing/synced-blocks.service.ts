import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

/**
 * Phase 8 — synced blocks (spec §5/§6). A SyncedBlock owns its OWN Yjs document
 * (keyed `synced:{id}`, served by the sync server). The API only mints the row
 * and gates read access by workspace membership; the actual collaborative
 * content lives in `ydocState`, persisted by the sync server's Database
 * extension. Embedding the same id on two pages → same doc → edits propagate.
 */
@Injectable()
export class SyncedBlocksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  /** Create a synced block in a workspace (requires membership). Returns `{ id }`. */
  async create(userId: string, workspaceId: string): Promise<{ id: string }> {
    await this.workspaces.requireMember(userId, workspaceId);
    const block = await this.prisma.syncedBlock.create({
      data: { workspaceId },
      select: { id: true },
    });
    return { id: block.id };
  }

  /**
   * Fetch a synced block's metadata (requires membership of its workspace). 404
   * when it does not exist; 403 when the caller is not a member — matching the
   * sync server's `synced:{id}` authorization so API and sync agree (spec §9).
   */
  async get(userId: string, id: string) {
    const block = await this.prisma.syncedBlock.findUnique({
      where: { id },
      select: { id: true, workspaceId: true, createdAt: true },
    });
    if (!block) throw new NotFoundException("Synced block not found");
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: block.workspaceId, userId } },
    });
    if (!member) {
      throw new ForbiddenException("You are not a member of this workspace");
    }
    return block;
  }
}
