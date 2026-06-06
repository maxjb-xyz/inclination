import { z } from "zod";

/**
 * Phase 8 — Markdown import/export inputs (spec §1, §8).
 *
 * Export turns a page's body into a Markdown string server-side; import parses a
 * Markdown document into a page tree (splitting on top-level `#` H1 sections).
 */

/** Import a Markdown document into a workspace: `POST /workspaces/:wsId/import/markdown`. */
export const importMarkdownSchema = z.object({
  /** Original filename; used to derive the top page title when there is no H1. */
  filename: z.string().min(1).max(512),
  markdown: z.string().max(5_000_000),
});
export type ImportMarkdownInput = z.infer<typeof importMarkdownSchema>;
