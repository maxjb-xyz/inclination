import { PrismaClient } from "@prisma/client";

export { PrismaClient };
export type { Prisma } from "@prisma/client";

/**
 * Lazily-created process-wide PrismaClient singleton. Services import this so
 * connection pooling is shared rather than re-instantiated per module.
 */
let singleton: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!singleton) {
    singleton = new PrismaClient();
  }
  return singleton;
}
