import { z } from "zod";
import { PERMISSION_ROLES } from "./constants";

/**
 * Phase 6 T3 — sharing/permission inputs (spec §5/§6).
 *
 * A `Permission` grants a subject (a workspace member `user`, or the whole
 * `workspace`) a role on a page. `public` grants are Phase-8 publishing and are
 * NOT mutable through these endpoints (the resolver still honours them on read).
 *
 * The role is one of the shared `PERMISSION_ROLES` (full | edit | comment |
 * read) → the resolver maps it to capabilities.
 */

/** Subject types a sharing mutation may target (public is Phase 8 only). */
export const SHARE_SUBJECT_TYPES = ["user", "workspace"] as const;
export type ShareSubjectType = (typeof SHARE_SUBJECT_TYPES)[number];

/**
 * Upsert a grant on a page: `PUT /pages/:id/permissions`.
 * `subjectId` is the userId (subjectType=user) or workspaceId (subjectType=
 * workspace). The service validates the subject exists and belongs to the page's
 * workspace.
 */
export const upsertPermissionSchema = z.object({
  subjectType: z.enum(SHARE_SUBJECT_TYPES),
  subjectId: z.string().uuid(),
  role: z.enum(PERMISSION_ROLES),
});
export type UpsertPermissionInput = z.infer<typeof upsertPermissionSchema>;

/**
 * Invite a person to a single page by email: `POST /pages/:id/share-invite`.
 * If a user with that email exists they are ensured into the workspace as a
 * `guest` (if not already a member) and granted the role on the page; otherwise
 * a workspace `Invitation` (role guest) is created so that on acceptance they
 * become a guest — the page grant is applied to existing users only (see the
 * service docs for the no-account fallback).
 */
export const shareInviteSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(PERMISSION_ROLES),
});
export type ShareInviteInput = z.infer<typeof shareInviteSchema>;
