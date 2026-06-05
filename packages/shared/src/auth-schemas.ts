import { z } from "zod";
import { WORKSPACE_ROLES } from "./constants";

/** Roles assignable via invitation — everything except `owner` (the creator). */
export const INVITABLE_ROLES = WORKSPACE_ROLES.filter((r) => r !== "owner") as Exclude<
  (typeof WORKSPACE_ROLES)[number],
  "owner"
>[];

const email = z.string().trim().toLowerCase().email();
const password = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(200, "Password is too long");
const displayName = z.string().trim().min(1).max(80);

export const registerSchema = z.object({
  email,
  password,
  displayName,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const verifyEmailSchema = z.object({ token: z.string().min(1) });
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(1) });
export type RefreshInput = z.infer<typeof refreshSchema>;

export const passwordResetRequestSchema = z.object({ email });
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(1),
  password,
});
export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;

export const updateProfileSchema = z
  .object({
    displayName: displayName.optional(),
    avatarUrl: z.string().url().max(2000).nullable().optional(),
  })
  .refine((v) => v.displayName !== undefined || v.avatarUrl !== undefined, {
    message: "At least one field must be provided",
  });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  icon: z.string().max(100).optional(),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    icon: z.string().max(100).nullable().optional(),
    settings: z.record(z.unknown()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;

export const inviteSchema = z.object({
  email,
  role: z.enum(INVITABLE_ROLES as [string, ...string[]]),
});
export type InviteInput = z.infer<typeof inviteSchema>;

export const acceptInvitationSchema = z.object({ token: z.string().min(1) });
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
