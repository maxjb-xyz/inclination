// Re-export the full generated Prisma client surface: PrismaClient, the Prisma
// namespace, all model types (User, Workspace, WorkspaceMember, …) and enums.
export * from "@prisma/client";
export { getPrisma } from "./client";
export {
  resolvePageAccess,
  capabilitiesForRole,
  type PageAccess,
  type PageAccessPrisma,
  type PermissionRole,
} from "./permissions";
