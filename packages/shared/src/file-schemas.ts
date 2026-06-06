import { z } from "zod";
import { ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_SIZE_BYTES } from "./constants";

/**
 * Presigned-upload request (spec §9). The client declares the file it wants to
 * upload; the API validates the declared `mime` against the allowlist and the
 * declared `size` against the cap BEFORE issuing a presigned PUT URL. (MinIO
 * additionally enforces these at PUT time via the signed content-length/type
 * where supported, but rejecting up front gives a clean 400.)
 */
export const presignUploadSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mime: z.enum(ALLOWED_UPLOAD_MIME_TYPES),
  size: z.number().int().positive().max(MAX_UPLOAD_SIZE_BYTES),
  /** Optional page the attachment belongs to (image/file block context). */
  pageId: z.string().uuid().optional(),
});
export type PresignUploadInput = z.infer<typeof presignUploadSchema>;

/** Response from the presign endpoint. */
export interface PresignUploadResult {
  /** Presigned PUT URL the browser uploads bytes to directly. */
  uploadUrl: string;
  /** The MinIO object key the bytes are stored under. */
  objectKey: string;
  /** The created Attachment row id. */
  attachmentId: string;
  /** API path to fetch a (presigned) download URL for this attachment. */
  downloadPath: string;
}
