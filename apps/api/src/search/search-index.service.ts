import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Maintains the `SearchIndex` rows that the API is responsible for (spec §6).
 *
 * The sync server owns the prose `bodyText` (extracted from the Yjs doc on
 * save); the API owns two other contributions:
 *   - the page **title** (updated on rename), and
 *   - **database cell text** for `row` pages (a row is itself a Page, so its
 *     SearchIndex `bodyText` is the concatenation of its cells' text values).
 *
 * The Postgres trigger (see the `search_files` migration) recomputes the `tsv`
 * column from `title || ' ' || bodyText` on every insert/update, so this service
 * only ever sets the scalar columns. All methods are BEST-EFFORT: a failure here
 * must never break the originating mutation (rename / cell set), so callers
 * invoke them fire-and-forget and we swallow+log errors.
 */
@Injectable()
export class SearchIndexService {
  private readonly logger = new Logger(SearchIndexService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Refresh a page's SearchIndex `title` (and ensure the row exists). Reads the
   * page's current title + workspace. Preserves any existing `bodyText`. Used on
   * page rename so the title is searchable immediately (the sync server may not
   * store the body again for a while).
   */
  async syncTitle(pageId: string): Promise<void> {
    try {
      const page = await this.prisma.page.findUnique({
        where: { id: pageId },
        select: { workspaceId: true, title: true },
      });
      if (!page) return;
      await this.prisma.searchIndex.upsert({
        where: { pageId },
        create: {
          pageId,
          workspaceId: page.workspaceId,
          title: page.title,
          bodyText: "",
        },
        update: { workspaceId: page.workspaceId, title: page.title },
      });
    } catch (err) {
      this.logger.warn(`syncTitle(${pageId}) failed: ${String(err)}`);
    }
  }

  /**
   * Recompute a row Page's SearchIndex `bodyText` from the concatenation of its
   * cell text values, and keep its title in sync with the row Page's title. A
   * row has no Yjs prose body, so its cells ARE its searchable body — this makes
   * database content (e.g. a task title/notes cell) findable via the same index.
   */
  async syncRowCells(rowPageId: string): Promise<void> {
    try {
      const page = await this.prisma.page.findUnique({
        where: { id: rowPageId },
        select: { workspaceId: true, title: true },
      });
      if (!page) return;

      const cells = await this.prisma.cell.findMany({
        where: { rowPageId },
        select: { value: true },
      });
      const bodyText = cells
        .map((c) => cellValueToText(c.value))
        .filter((s) => s.length > 0)
        .join(" ")
        .slice(0, 100_000);

      await this.prisma.searchIndex.upsert({
        where: { pageId: rowPageId },
        create: { pageId: rowPageId, workspaceId: page.workspaceId, title: page.title, bodyText },
        update: { workspaceId: page.workspaceId, title: page.title, bodyText },
      });
    } catch (err) {
      this.logger.warn(`syncRowCells(${rowPageId}) failed: ${String(err)}`);
    }
  }
}

/**
 * Flatten a (JSON) cell value into searchable text. Handles the common typed
 * shapes the engine stores: plain strings/numbers, arrays (multi-select),
 * select/status `{ name }`, date `{ start/end }`, and falls back to a shallow
 * stringify of object values. Kept exported + pure for unit testing.
 */
export function cellValueToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((v) => cellValueToText(v)).join(" ");
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // Common labelled shapes: { name }, { start, end }, { url }, { email }, …
    const parts: string[] = [];
    for (const key of ["name", "title", "text", "url", "email", "phone", "start", "end"]) {
      const v = obj[key];
      if (typeof v === "string" || typeof v === "number") parts.push(String(v));
    }
    if (parts.length > 0) return parts.join(" ");
    // Fallback: stringify scalar leaves of the object.
    return Object.values(obj)
      .map((v) => (typeof v === "string" || typeof v === "number" ? String(v) : ""))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}
