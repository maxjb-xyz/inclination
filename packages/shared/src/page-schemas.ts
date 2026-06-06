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
