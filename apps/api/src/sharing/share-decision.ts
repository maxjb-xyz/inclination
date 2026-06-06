/**
 * Pure helper for the share-invite / grant "no-downgrade" decision (Phase 6
 * follow-up). Kept free of Prisma so it is trivially unit-testable.
 *
 * The bug: `share-invite` (and an upsert) would write an explicit page grant for
 * a subject who ALREADY resolves to an equal-or-higher role via the workspace
 * default (e.g. an owner/admin → `full`, a member → `edit`). An explicit grant
 * beats the default, so writing a weaker grant (e.g. `read`) would DOWNGRADE
 * that subject on the page. The fix: skip writing the grant when the subject's
 * CURRENT effective role on the page is already ≥ the requested role AND that
 * effective role does not come from an explicit grant on THIS page (re-granting
 * the same explicit row is fine — it is not a downgrade of a default/inherited
 * higher access).
 */

import type { PermissionRole } from "@inclination/db";

/** Higher value = more permissive. */
const ROLE_RANK: Record<PermissionRole, number> = {
  read: 0,
  comment: 1,
  edit: 2,
  full: 3,
};

/**
 * Decide whether to write the grant.
 *
 * @param currentRole       the subject's CURRENT effective role on the page
 *                          (from `resolvePageAccess`), or null if no access.
 * @param requestedRole     the role the sharer is trying to grant.
 * @param hasExplicitGrant  whether the subject already has an EXPLICIT grant row
 *                          on this exact page (vs. inheriting from a default or
 *                          an ancestor). When true, writing is allowed because
 *                          it just adjusts the subject's own explicit grant.
 * @returns true if the grant should be written; false to skip (no-downgrade).
 */
export function shouldWriteGrant(
  currentRole: PermissionRole | null,
  requestedRole: PermissionRole,
  hasExplicitGrant: boolean,
): boolean {
  // Always allow adjusting an existing explicit grant on this page.
  if (hasExplicitGrant) return true;
  // No effective access yet → safe to grant.
  if (currentRole === null) return true;
  // The subject already resolves to >= requested via a default/inherited grant:
  // writing a (weaker-or-equal) explicit grant would only downgrade them → skip.
  return ROLE_RANK[currentRole] < ROLE_RANK[requestedRole];
}
