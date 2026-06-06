import type { ApiClient } from "./apiClient";
import type { AttachmentUrl, PresignResult } from "./types";

/**
 * Stored attachment reference. Persisted on the editor node so the upload
 * survives reload: the served URL is re-resolved from `attachmentId` on load
 * (presigned GET URLs expire), with `downloadPath` as a stable fallback.
 */
export interface AttachmentRef {
  attachmentId: string;
  objectKey: string;
  downloadPath: string;
}

/** A file-like input — narrowed to the bits the upload flow needs (testable). */
export interface UploadFile {
  name: string;
  type: string;
  size: number;
  /** Bytes to PUT. `File`/`Blob` satisfy this for the real upload. */
  arrayBuffer?: () => Promise<ArrayBuffer>;
}

/** Raw fetch used for the direct-to-storage PUT (no auth, no /api prefix). */
export type RawFetch = typeof fetch;

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

/**
 * Builds the file-upload flow, parameterised by an {@link ApiClient} and a raw
 * fetch for the storage PUT so it can be unit-tested without a network.
 *
 * Flow (T2): presign → PUT bytes to the returned `uploadUrl` with the SAME
 * `Content-Type` → return the {@link AttachmentRef} (stored on the node).
 */
export function createUploadApi(
  client: ApiClient,
  rawFetch: RawFetch = (...args) => globalThis.fetch(...args),
) {
  /** Presign an upload, PUT the bytes, and return the stored attachment ref. */
  async function uploadFile(
    wsId: string,
    file: UploadFile,
    opts: { pageId?: string } = {},
  ): Promise<AttachmentRef> {
    const presign = await client.post<PresignResult>(
      `/workspaces/${wsId}/uploads/presign`,
      {
        filename: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
        ...(opts.pageId ? { pageId: opts.pageId } : {}),
      },
    );

    const body = file.arrayBuffer ? await file.arrayBuffer() : (file as unknown as BodyInit);
    const put = await rawFetch(presign.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: body as BodyInit,
    });
    if (!put.ok) {
      throw new UploadError(`Upload failed (${put.status})`);
    }

    return {
      attachmentId: presign.attachmentId,
      objectKey: presign.objectKey,
      downloadPath: presign.downloadPath,
    };
  }

  /** Resolve a fresh presigned GET URL for a stored attachment. */
  async function resolveUrl(attachmentId: string): Promise<string> {
    const res = await client.get<AttachmentUrl>(`/attachments/${attachmentId}`);
    return res.url;
  }

  return { uploadFile, resolveUrl };
}

export type UploadApi = ReturnType<typeof createUploadApi>;
