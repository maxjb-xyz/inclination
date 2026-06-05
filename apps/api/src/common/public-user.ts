import type { User } from "@inclination/db";

/** User shape safe to return over the API (never includes passwordHash). */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  createdAt: string;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}
