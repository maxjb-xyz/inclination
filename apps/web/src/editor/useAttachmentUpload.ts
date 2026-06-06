import { useCallback, useEffect, useState } from "react";
import { apiClient } from "../api/apiClient";
import { createUploadApi, type AttachmentRef } from "../api/uploadHelper";

const uploadApi = createUploadApi(apiClient);

export type UploadStatus = "idle" | "uploading" | "error";

export interface UploadHandle {
  status: UploadStatus;
  error: string | null;
  /** Presign + PUT a file; resolves to the stored attachment reference. */
  upload: (wsId: string, file: File, pageId?: string) => Promise<AttachmentRef | null>;
  reset: () => void;
}

/** Drives the presign→PUT upload flow with status/error for a media NodeView. */
export function useAttachmentUpload(): UploadHandle {
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (wsId: string, file: File, pageId?: string): Promise<AttachmentRef | null> => {
      setStatus("uploading");
      setError(null);
      try {
        const ref = await uploadApi.uploadFile(wsId, file, { pageId });
        setStatus("idle");
        return ref;
      } catch (e) {
        setStatus("error");
        setError(e instanceof Error ? e.message : "Upload failed");
        return null;
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
  }, []);

  return { status, error, upload, reset };
}

/**
 * Resolve a fresh served URL for a stored attachment id. Presigned GET URLs
 * expire, so this re-resolves on load (this is what makes an uploaded media
 * survive reload — the node persists `attachmentId`, not a stale URL).
 */
export function useResolvedAttachmentUrl(attachmentId: string | null): {
  url: string | null;
  error: boolean;
} {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!attachmentId) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    setError(false);
    uploadApi
      .resolveUrl(attachmentId)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attachmentId]);

  return { url, error };
}
