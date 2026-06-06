import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PublishPageInput } from "@inclination/shared";
import { resolvePageAccess } from "@inclination/db";
import type { Page } from "@inclination/db";
import { proseMirrorToMarkdown } from "@inclination/editor";
import { PrismaService } from "../prisma/prisma.service";
import { ydocStateToProseMirror } from "./ydoc-to-pm";
import { slugify, uniqueSlug } from "./slug";

/**
 * Phase 8 — page publishing (spec §5/§8).
 *
 * Authorization reuses the SAME shared `resolvePageAccess`:
 *   - publish/unpublish require `canShare` (mutating the public surface);
 *   - reading the current settings requires `canRead`.
 * The PUBLIC read endpoint (`getPublic`) is intentionally UNAUTHENTICATED and
 * serves ONLY `published === true` shares — it never resolves page access and
 * never reveals an unpublished page (404 instead), so it cannot leak content.
 */
@Injectable()
export class PublishingService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadPage(pageId: string): Promise<Page> {
    const page = await this.prisma.page.findUnique({ where: { id: pageId } });
    if (!page) throw new NotFoundException("Page not found");
    return page;
  }

  private async requireAccess(
    userId: string,
    pageId: string,
    capability: "read" | "share",
  ): Promise<Page> {
    const page = await this.loadPage(pageId);
    const access = await resolvePageAccess(this.prisma, userId, pageId);
    if (!access || !access.canRead) {
      throw new ForbiddenException("You do not have access to this page");
    }
    if (capability === "share" && !access.canShare) {
      throw new ForbiddenException("You do not have permission to publish this page");
    }
    return page;
  }

  /**
   * Publish (or re-publish) a page (requires `canShare`). Stores the editor's
   * rendered HTML snapshot + title; derives a UNIQUE url-safe slug from the
   * supplied slug or the title (appending -2/-3 on collision), preserving an
   * existing share's slug when the caller does not request a new one.
   */
  async publish(userId: string, pageId: string, input: PublishPageInput) {
    await this.requireAccess(userId, pageId, "share");

    const existing = await this.prisma.publicShare.findUnique({ where: { pageId } });

    // Determine the desired slug. Prefer an explicit request; otherwise keep the
    // existing slug; otherwise derive from the title.
    let slug = existing?.slug ?? "";
    const requestedBase = input.slug ? slugify(input.slug) : "";
    const needsNewSlug =
      (input.slug && requestedBase && requestedBase !== existing?.slug) || !existing;
    if (needsNewSlug) {
      const base = requestedBase || slugify(input.title) || "page";
      slug = await uniqueSlug(base, async (candidate) => {
        const owner = await this.prisma.publicShare.findUnique({
          where: { slug: candidate },
          select: { pageId: true },
        });
        return owner !== null && owner.pageId !== pageId;
      });
    }

    const share = await this.prisma.publicShare.upsert({
      where: { pageId },
      create: {
        pageId,
        slug,
        published: true,
        includeSubpages: input.includeSubpages,
        allowDuplicate: input.allowDuplicate,
        publishedHtml: input.html,
        publishedTitle: input.title,
      },
      update: {
        slug,
        published: true,
        includeSubpages: input.includeSubpages,
        allowDuplicate: input.allowDuplicate,
        publishedHtml: input.html,
        publishedTitle: input.title,
      },
    });

    return this.toSettings(share);
  }

  /** Mark a page's share unpublished (requires `canShare`). Keeps the slug. */
  async unpublish(userId: string, pageId: string) {
    await this.requireAccess(userId, pageId, "share");
    const existing = await this.prisma.publicShare.findUnique({ where: { pageId } });
    if (!existing) {
      // Nothing to unpublish — idempotent success with a null settings shape.
      return { published: false };
    }
    const share = await this.prisma.publicShare.update({
      where: { pageId },
      data: { published: false },
    });
    return this.toSettings(share);
  }

  /** Current publish settings for a page (requires `canRead`); null if never published. */
  async getSettings(userId: string, pageId: string) {
    await this.requireAccess(userId, pageId, "read");
    const share = await this.prisma.publicShare.findUnique({ where: { pageId } });
    return share ? this.toSettings(share) : null;
  }

  /**
   * UNAUTHENTICATED public read by slug (spec §8 gate: viewable while logged
   * out). Returns the published HTML + title ONLY when `published === true`;
   * otherwise 404 — an unpublished/unknown slug is indistinguishable, so no
   * unpublished content can ever leak. When `includeSubpages`, lists the
   * PUBLISHED descendants as `{ slug, title }`.
   */
  async getPublic(slug: string) {
    const share = await this.prisma.publicShare.findUnique({ where: { slug } });
    if (!share || !share.published) {
      throw new NotFoundException("Published page not found");
    }

    const result: {
      title: string;
      html: string;
      includeSubpages: boolean;
      allowDuplicate: boolean;
      subpages?: { slug: string; title: string }[];
    } = {
      title: share.publishedTitle ?? "",
      html: share.publishedHtml ?? "",
      includeSubpages: share.includeSubpages,
      allowDuplicate: share.allowDuplicate,
    };

    if (share.includeSubpages) {
      result.subpages = await this.publishedDescendants(share.pageId);
    }

    return result;
  }

  /**
   * Walk the page subtree (BFS over non-archived pages) and return the published
   * descendants' { slug, title }. Only descendants that themselves have a
   * `published` PublicShare are surfaced — a descendant the publisher did not
   * publish stays private.
   */
  private async publishedDescendants(
    rootId: string,
  ): Promise<{ slug: string; title: string }[]> {
    const descendantIds: string[] = [];
    let frontier: string[] = [rootId];
    // Bound the walk so a pathological tree can't loop.
    let guard = 0;
    while (frontier.length > 0 && guard < 10_000) {
      guard += 1;
      const children = await this.prisma.page.findMany({
        where: { parentId: { in: frontier }, archivedAt: null },
        select: { id: true },
      });
      const next = children.map((c) => c.id);
      descendantIds.push(...next);
      frontier = next;
    }
    if (descendantIds.length === 0) return [];

    const shares = await this.prisma.publicShare.findMany({
      where: { pageId: { in: descendantIds }, published: true },
      select: { slug: true, publishedTitle: true, pageId: true },
    });
    return shares.map((s) => ({ slug: s.slug, title: s.publishedTitle ?? "" }));
  }

  /** Shape a PublicShare row into the settings payload returned to the owner. */
  private toSettings(share: {
    slug: string;
    published: boolean;
    includeSubpages: boolean;
    allowDuplicate: boolean;
    publishedTitle: string | null;
  }) {
    return {
      slug: share.slug,
      published: share.published,
      includeSubpages: share.includeSubpages,
      allowDuplicate: share.allowDuplicate,
      title: share.publishedTitle ?? "",
    };
  }

  /**
   * Export a page's body as Markdown (requires `canRead`). Decodes the page's
   * Yjs document to ProseMirror-JSON via a structured walk, then serializes that
   * to Markdown. Falls back to the legacy `PageContent.doc` (PM-JSON) when there
   * is no Yjs state yet (older pages). The H1 title line is prepended.
   */
  async exportMarkdown(userId: string, pageId: string) {
    const page = await this.requireAccess(userId, pageId, "read");
    const content = await this.prisma.pageContent.findUnique({ where: { pageId } });

    let pmDoc;
    if (content?.ydocState) {
      const bytes =
        content.ydocState instanceof Uint8Array
          ? content.ydocState
          : new Uint8Array(content.ydocState);
      pmDoc = ydocStateToProseMirror(bytes);
    } else {
      // Legacy/back-compat path: the stored ProseMirror JSON.
      pmDoc = (content?.doc ?? { type: "doc", content: [] }) as Parameters<
        typeof proseMirrorToMarkdown
      >[0];
    }

    const body = proseMirrorToMarkdown(pmDoc);
    const title = page.title || "Untitled";
    const markdown = body ? `# ${title}\n\n${body}\n` : `# ${title}\n`;
    const filename = `${slugify(title) || "page"}.md`;
    return { filename, markdown };
  }
}
