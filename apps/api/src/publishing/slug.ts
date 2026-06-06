/**
 * Pure URL-safe slug helpers for publishing (spec §5). Kept dependency-free so
 * the derivation + uniqueness suffixing can be unit-tested without a database.
 */

/**
 * Normalize an arbitrary string into a URL-safe slug: lowercase, ASCII letters
 * and digits only, words joined by single hyphens, with leading/trailing hyphens
 * stripped. Returns "" when nothing usable remains (caller substitutes a
 * fallback). Caps length to keep slugs sane.
 */
export function slugify(input: string, maxLength = 80): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug;
}

/**
 * Given a desired base slug and a predicate that reports whether a candidate is
 * already taken (by a DIFFERENT page), return a unique slug, appending `-2`,
 * `-3`, … until free. `isTaken` is async so it can hit the database.
 */
export async function uniqueSlug(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const root = base || "page";
  if (!(await isTaken(root))) return root;
  for (let n = 2; n < 10_000; n += 1) {
    const candidate = `${root}-${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  // Extremely unlikely fallback: append a timestamp to guarantee uniqueness.
  return `${root}-${Date.now()}`;
}
