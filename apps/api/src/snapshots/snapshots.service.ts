import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { resolvePageAccess } from "@inclination/db";
import type {
  CreateSnapshotInput,
  SnapshotContent,
  SnapshotSummary,
} from "@inclination/shared";
import { PrismaService } from "../prisma/prisma.service";
import { snapshotPreviewText } from "./yjs-text";

/**
 * Version history (spec §5). Lists / previews / creates / restores a page's
 * Yjs snapshots. Authorization goes through the SAME shared `resolvePageAccess`
 * resolver the rest of the system uses: canRead for list/preview, canWrite for
 * manual create + restore.
 */
@Injectable()
export class SnapshotsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Assert the caller may access page `pageId` at the given capability (404/403). */
  private async requirePageAccess(
    userId: string,
    pageId: string,
    capability: "read" | "write",
  ): Promise<void> {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { id: true },
    });
    if (!page) throw new NotFoundException("Page not found");
    const access = await resolvePageAccess(this.prisma, userId, pageId);
    if (!access || !access.canRead) {
      throw new ForbiddenException("You do not have access to this page");
    }
    if (capability === "write" && !access.canWrite) {
      throw new ForbiddenException("You do not have permission to edit this page");
    }
  }

  private toSummary(s: {
    id: string;
    label: string | null;
    authorId: string | null;
    createdAt: Date;
  }): SnapshotSummary {
    return {
      id: s.id,
      label: s.label,
      authorId: s.authorId,
      createdAt: s.createdAt.toISOString(),
    };
  }

  /** List a page's snapshots (newest first) for an accessible page. */
  async list(userId: string, pageId: string): Promise<SnapshotSummary[]> {
    await this.requirePageAccess(userId, pageId, "read");
    const rows = await this.prisma.pageSnapshot.findMany({
      where: { pageId },
      orderBy: { createdAt: "desc" },
      select: { id: true, label: true, authorId: true, createdAt: true },
    });
    return rows.map((r) => this.toSummary(r));
  }

  /**
   * A snapshot's content for read-only preview. Decodes the Yjs state to plain
   * text (`decoded: false` — full ProseMirror-JSON decode needs the editor
   * schema, which is web-only; the web panel renders a richer preview).
   */
  async preview(userId: string, pageId: string, snapshotId: string): Promise<SnapshotContent> {
    await this.requirePageAccess(userId, pageId, "read");
    const snap = await this.prisma.pageSnapshot.findUnique({
      where: { id: snapshotId },
    });
    if (!snap || snap.pageId !== pageId) {
      throw new NotFoundException("Snapshot not found");
    }
    const bytes =
      snap.ydocSnapshot instanceof Uint8Array
        ? snap.ydocSnapshot
        : new Uint8Array(snap.ydocSnapshot);
    return {
      ...this.toSummary(snap),
      doc: null,
      text: snapshotPreviewText(bytes),
      decoded: false,
    };
  }

  /**
   * Capture the page's CURRENT Yjs state as a manual snapshot (spec §5). Handy
   * for the gate ("create a version, restore it"). Requires write access. Throws
   * 400-style NotFound if the page has no persisted Yjs state yet (nothing to
   * snapshot).
   */
  async create(
    userId: string,
    pageId: string,
    input: CreateSnapshotInput,
  ): Promise<SnapshotSummary> {
    await this.requirePageAccess(userId, pageId, "write");
    const content = await this.prisma.pageContent.findUnique({
      where: { pageId },
      select: { ydocState: true },
    });
    if (!content?.ydocState) {
      throw new NotFoundException("Page has no collaborative content to snapshot yet");
    }
    const snap = await this.prisma.pageSnapshot.create({
      data: {
        pageId,
        ydocSnapshot: toBytes(content.ydocState),
        label: input.label ?? null,
        authorId: userId,
      },
      select: { id: true, label: true, authorId: true, createdAt: true },
    });
    return this.toSummary(snap);
  }

  /**
   * Restore a snapshot (spec §5, requires write). For safety, the page's CURRENT
   * state is first captured as an automatic snapshot, then `PageContent.ydocState`
   * is set to the snapshot's bytes. Live-connected clients pick the restored
   * state up on reload/reconnect (full live-restore is a follow-up).
   */
  async restore(
    userId: string,
    pageId: string,
    snapshotId: string,
  ): Promise<{ restored: true; safetySnapshotId: string | null }> {
    await this.requirePageAccess(userId, pageId, "write");

    const snap = await this.prisma.pageSnapshot.findUnique({
      where: { id: snapshotId },
    });
    if (!snap || snap.pageId !== pageId) {
      throw new NotFoundException("Snapshot not found");
    }

    // Safety-snapshot the current state first so a restore is itself undoable.
    let safetySnapshotId: string | null = null;
    const current = await this.prisma.pageContent.findUnique({
      where: { pageId },
      select: { ydocState: true },
    });
    if (current?.ydocState) {
      const safety = await this.prisma.pageSnapshot.create({
        data: {
          pageId,
          ydocSnapshot: toBytes(current.ydocState),
          label: "Before restore",
          authorId: userId,
        },
        select: { id: true },
      });
      safetySnapshotId = safety.id;
    }

    const bytes = toBytes(snap.ydocSnapshot);
    await this.prisma.pageContent.upsert({
      where: { pageId },
      create: { pageId, ydocState: bytes },
      update: { ydocState: bytes },
    });
    await this.prisma.page.update({ where: { id: pageId }, data: { editedById: userId } });

    return { restored: true, safetySnapshotId };
  }
}

/**
 * Normalize a (possibly Buffer-backed) byte source into a plain `ArrayBuffer`-
 * backed `Uint8Array`, which is what Prisma's `Bytes` column expects on write.
 * Copies so the stored bytes are decoupled from the source row.
 */
function toBytes(state: Uint8Array): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(state.length);
  const out = new Uint8Array(buffer);
  out.set(state);
  return out as Uint8Array<ArrayBuffer>;
}
