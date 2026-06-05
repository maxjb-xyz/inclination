/** Product-wide constants shared across services. */

export const APP_NAME = "Inclination";

/** Workspace member roles (spec §5). */
export const WORKSPACE_ROLES = ["owner", "admin", "member", "guest"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** Page kinds — the universal node (spec §5). */
export const PAGE_TYPES = ["document", "database", "row"] as const;
export type PageType = (typeof PAGE_TYPES)[number];

/** Permission roles (spec §5). */
export const PERMISSION_ROLES = ["full", "edit", "comment", "read"] as const;
export type PermissionRole = (typeof PERMISSION_ROLES)[number];
