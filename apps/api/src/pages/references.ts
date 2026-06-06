/**
 * Pure helpers for page references / backlinks (Phase 4, spec §7).
 *
 * Kept free of Prisma so the set-replacement logic and target filtering are
 * trivially unit-testable. The service wires these to the database.
 */

/** A page reference target reduced to the fields needed for filtering. */
export interface ReferenceCandidate {
  id: string;
  workspaceId: string;
}

/**
 * Given the requested target page ids, the source page, and the candidate
 * pages that actually exist in the SAME workspace, returns the valid set of
 * target ids: existing, same-workspace, and excluding self-references.
 *
 * `candidates` is the result of looking up the requested ids restricted to the
 * source page's workspace; anything not present is implicitly cross-workspace
 * or non-existent and therefore dropped.
 */
export function filterReferenceTargets(
  requestedIds: string[],
  fromPageId: string,
  candidates: ReferenceCandidate[],
): string[] {
  const valid = new Set(candidates.map((c) => c.id));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of requestedIds) {
    if (id === fromPageId) continue; // no self-reference
    if (!valid.has(id)) continue; // cross-workspace or missing
    if (seen.has(id)) continue; // dedupe
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Diffs the current set of outgoing target ids against the desired set,
 * returning which references to delete and which to insert so the stored set
 * exactly matches `desired`.
 */
export function computeReferenceDiff(
  current: string[],
  desired: string[],
): { toDelete: string[]; toInsert: string[] } {
  const currentSet = new Set(current);
  const desiredSet = new Set(desired);
  const toDelete = current.filter((id) => !desiredSet.has(id));
  const toInsert = desired.filter((id) => !currentSet.has(id));
  return { toDelete, toInsert };
}
