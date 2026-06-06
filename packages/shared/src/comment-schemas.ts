import { z } from "zod";

/**
 * Phase 6 — comment inputs (spec §5/§6).
 *
 * A comment `body` is rich-text JSON (a ProseMirror/Tiptap fragment, same shape
 * the editor produces). We accept an arbitrary JSON object and let the comments
 * service walk it for `mention` nodes; we only require it be non-empty so an
 * empty comment cannot be created.
 *
 * `blockAnchor` (optional) makes the comment inline-anchored to a span of a
 * block: `{ blockId, from, to }`. When omitted the comment is page-level.
 * `parentCommentId` (optional) makes the comment a reply, inheriting the
 * parent's `threadId`.
 */
export const blockAnchorSchema = z.object({
  blockId: z.string().min(1).max(200),
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
});
export type BlockAnchor = z.infer<typeof blockAnchorSchema>;

export const createCommentSchema = z.object({
  body: z.record(z.unknown()).refine((v) => Object.keys(v).length > 0, {
    message: "Comment body cannot be empty",
  }),
  blockAnchor: blockAnchorSchema.optional(),
  parentCommentId: z.string().uuid().optional(),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
