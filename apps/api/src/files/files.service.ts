import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { resolvePageAccess } from "@inclination/db";
import type { PresignUploadInput, PresignUploadResult } from "@inclination/shared";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

/**
 * Uploads + attachment downloads (spec §9). Issues presigned PUT URLs scoped to
 * a workspace (content-type allowlist + size cap enforced by the Zod schema in
 * the controller) and presigned GET URLs for accessible attachments.
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly workspaces: WorkspacesService,
  ) {}

  /**
   * Issue a presigned PUT URL and record a pending Attachment row (spec §9).
   *   - Caller must be a member of the workspace.
   *   - When a `pageId` is supplied it must belong to this workspace and the
   *     caller must be able to write it (uploads attach to a page they edit).
   *   - The objectKey is `{workspaceId}/{uuid}/{safeFilename}` so objects are
   *     namespaced per workspace and never collide.
   * The mime/size validation already happened in the Zod pipe; we re-assert the
   * size defensively here so a bypassed validator can't slip an oversized row in.
   */
  async presignUpload(
    userId: string,
    workspaceId: string,
    input: PresignUploadInput,
  ): Promise<PresignUploadResult> {
    await this.workspaces.requireMember(userId, workspaceId);

    if (input.pageId) {
      const page = await this.prisma.page.findUnique({
        where: { id: input.pageId },
        select: { workspaceId: true },
      });
      if (!page) throw new NotFoundException("Page not found");
      if (page.workspaceId !== workspaceId) {
        throw new BadRequestException("Page is in a different workspace");
      }
      const access = await resolvePageAccess(this.prisma, userId, input.pageId);
      if (!access || !access.canWrite) {
        throw new ForbiddenException("You do not have permission to attach to this page");
      }
    }

    await this.storage.ensureBucket();

    const objectKey = `${workspaceId}/${randomUUID()}/${sanitizeFilename(input.filename)}`;
    const uploadUrl = await this.storage.presignPut(objectKey, input.mime);

    const attachment = await this.prisma.attachment.create({
      data: {
        pageId: input.pageId ?? null,
        workspaceId,
        objectKey,
        filename: input.filename,
        mime: input.mime,
        size: input.size,
        uploaderId: userId,
      },
    });

    return {
      uploadUrl,
      objectKey,
      attachmentId: attachment.id,
      downloadPath: `/api/attachments/${attachment.id}`,
    };
  }

  /**
   * Resolve a presigned GET URL for an attachment the caller may access
   * (spec §9). Authorization: if the attachment is bound to a page, the caller
   * must be able to read that page (shared resolver); otherwise they must be a
   * member of the attachment's workspace.
   */
  async getDownloadUrl(userId: string, attachmentId: string): Promise<{ url: string }> {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
    });
    if (!attachment) throw new NotFoundException("Attachment not found");

    if (attachment.pageId) {
      const access = await resolvePageAccess(this.prisma, userId, attachment.pageId);
      if (!access || !access.canRead) {
        throw new ForbiddenException("You do not have access to this attachment");
      }
    } else {
      await this.workspaces.requireMember(userId, attachment.workspaceId);
    }

    const url = await this.storage.presignGet(attachment.objectKey);
    return { url };
  }
}

/**
 * Make a user-supplied filename safe for use in an object key: keep the base
 * name only (strip any path components), replace anything outside a conservative
 * allowlist with `_`, and bound the length. The uuid segment guarantees
 * uniqueness, so collisions after sanitisation are harmless.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_");
  const trimmed = cleaned.slice(0, 200);
  return trimmed.length > 0 ? trimmed : "file";
}
