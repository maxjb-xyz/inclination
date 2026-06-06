import { z } from "zod";
import { PAGE_TYPES } from "./constants";

const title = z.string().max(2000);
const icon = z.string().max(100);
const cover = z.string().max(2000);

export const createPageSchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  type: z.enum(PAGE_TYPES).optional(),
  title: title.optional(),
  icon: icon.optional(),
});
export type CreatePageInput = z.infer<typeof createPageSchema>;

export const updatePageSchema = z
  .object({
    title: title.optional(),
    icon: icon.nullable().optional(),
    cover: cover.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });
export type UpdatePageInput = z.infer<typeof updatePageSchema>;

export const movePageSchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  beforeId: z.string().uuid().nullable().optional(),
  afterId: z.string().uuid().nullable().optional(),
});
export type MovePageInput = z.infer<typeof movePageSchema>;

export const saveContentSchema = z.object({
  doc: z.record(z.unknown()),
});
export type SaveContentInput = z.infer<typeof saveContentSchema>;

// Phase 4 — backlinks (spec §7). The editor recomputes the set of pages this
// page references (from pageLink / page-mention nodes) and PUTs it. Ids are
// deduped here so the server receives a clean set; a generous cap bounds the
// payload (a single doc realistically references far fewer pages).
export const setReferencesSchema = z.object({
  pageIds: z
    .array(z.string().uuid())
    .max(500)
    .transform((ids) => Array.from(new Set(ids))),
});
export type SetReferencesInput = z.infer<typeof setReferencesSchema>;
