import { z } from "zod";

/**
 * Full-text search query input (spec §5/§6). `q` is the raw user query passed to
 * Postgres `websearch_to_tsquery` (which safely parses operators like quotes and
 * `-`); the API never string-interpolates it into SQL. `limit` bounds the result
 * set; the default keeps the quick switcher snappy.
 */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(256),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});
export type SearchQueryInput = z.infer<typeof searchQuerySchema>;

/** A single search hit returned to the client. */
export interface SearchResult {
  pageId: string;
  title: string;
  /** `ts_headline` HTML-free snippet with matched terms marked by `[[`…`]]`. */
  snippet: string;
  /** `ts_rank` relevance score (higher = more relevant). */
  rank: number;
}
