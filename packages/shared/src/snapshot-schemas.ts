import { z } from "zod";

/**
 * Manual snapshot creation (spec §5 version history). An optional human label
 * distinguishes a user-captured snapshot from the automatic throttled ones the
 * sync server writes.
 */
export const createSnapshotSchema = z.object({
  label: z.string().trim().max(200).optional(),
});
export type CreateSnapshotInput = z.infer<typeof createSnapshotSchema>;

/** Snapshot metadata as listed in the version-history panel. */
export interface SnapshotSummary {
  id: string;
  label: string | null;
  authorId: string | null;
  createdAt: string;
}

/**
 * A snapshot's content for read-only preview. `doc` is the snapshot's Yjs state
 * decoded to ProseMirror JSON when decoding succeeds; `text` is the extracted
 * plain-text preview (always available). `decoded` indicates whether `doc` is a
 * real ProseMirror document or a fallback.
 */
export interface SnapshotContent extends SnapshotSummary {
  doc: unknown;
  text: string;
  decoded: boolean;
}
