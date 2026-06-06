import { z } from "zod";

/**
 * Phase 8 — publishing inputs (spec §5).
 *
 * Publishing stores a client-rendered HTML snapshot of the page at publish time
 * (the web app serializes the current Tiptap doc → HTML and sends it). The public
 * endpoint serves that HTML to logged-out viewers. Re-publishing refreshes it.
 */

/**
 * A URL-safe slug: lowercase letters, digits and single hyphens. The server
 * normalizes/derives one from the title when omitted and guarantees uniqueness
 * (appending -2/-3 on collision), so this is a soft client-supplied preference.
 */
export const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase alphanumeric words separated by hyphens");

/** Publish (or re-publish) a page: `POST /pages/:id/publish`. */
export const publishPageSchema = z.object({
  slug: slugSchema.optional(),
  includeSubpages: z.boolean().default(false),
  allowDuplicate: z.boolean().default(false),
  /** The page's current content rendered to HTML by the editor (snapshot). */
  html: z.string().max(5_000_000),
  title: z.string().max(2000),
});
export type PublishPageInput = z.infer<typeof publishPageSchema>;
