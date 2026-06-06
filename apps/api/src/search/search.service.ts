import { Injectable } from "@nestjs/common";
import { Prisma, resolvePageAccess } from "@inclination/db";
import type { SearchQueryInput, SearchResult } from "@inclination/shared";
import { PrismaService } from "../prisma/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

/** A raw row returned by the full-text query before access filtering. */
interface RawSearchRow {
  pageId: string;
  title: string;
  snippet: string;
  rank: number;
}

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  /**
   * Full-text search within a workspace (spec §6). Requires workspace
   * membership. Runs a PARAMETERIZED Postgres FTS query — the user query `q` is
   * never interpolated into SQL; it is bound and parsed by
   * `websearch_to_tsquery` (which safely handles quotes / `-` / OR). Results are
   * scoped to the workspace, ranked by `ts_rank`, and a `ts_headline` snippet is
   * produced over the title+body.
   *
   * The DB query intentionally over-fetches (a few × the requested limit) so the
   * subsequent per-page access filter — applied through the SAME shared
   * `resolvePageAccess` resolver the rest of the system uses — can drop pages the
   * caller may not see (e.g. a guest only sees explicitly-granted subtrees) and
   * still return up to `limit` accessible hits without a second round trip in the
   * common case.
   */
  async search(
    userId: string,
    workspaceId: string,
    input: SearchQueryInput,
  ): Promise<SearchResult[]> {
    await this.workspaces.requireMember(userId, workspaceId);

    const limit = input.limit;
    // Over-fetch to leave room for access-filtered-out rows; bounded so a guest
    // in a huge workspace doesn't force an unbounded scan.
    const fetchCount = Math.min(limit * 5, 200);

    // Parameterized: $1 workspaceId, $2 the raw query string, $3 fetch count.
    // `websearch_to_tsquery` parses $2 safely (no SQL injection surface). The
    // snippet marks matches with [[ ]] (StartSel/StopSel) so the client can
    // render highlights without us emitting HTML.
    const rows = await this.prisma.$queryRaw<RawSearchRow[]>(Prisma.sql`
      SELECT
        "pageId",
        "title",
        ts_headline(
          'english',
          coalesce("title", '') || ' ' || coalesce("bodyText", ''),
          websearch_to_tsquery('english', ${input.q}),
          'StartSel=[[, StopSel=]], MaxFragments=2, MaxWords=18, MinWords=5, ShortWord=2'
        ) AS "snippet",
        ts_rank("tsv", websearch_to_tsquery('english', ${input.q})) AS "rank"
      FROM "SearchIndex"
      WHERE "workspaceId" = ${workspaceId}
        AND "tsv" @@ websearch_to_tsquery('english', ${input.q})
      ORDER BY "rank" DESC
      LIMIT ${fetchCount}
    `);

    const results: SearchResult[] = [];
    for (const row of rows) {
      if (results.length >= limit) break;
      const access = await resolvePageAccess(this.prisma, userId, row.pageId);
      if (!access || !access.canRead) continue;
      results.push({
        pageId: row.pageId,
        title: row.title,
        snippet: row.snippet,
        // Prisma returns numeric rank as a number; coerce defensively.
        rank: typeof row.rank === "number" ? row.rank : Number(row.rank),
      });
    }
    return results;
  }
}
