import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublishPageInput } from "@inclination/shared";
import { apiClient } from "../api/apiClient";
import { createPublishingApi } from "../api/publishingApi";

const api = createPublishingApi(apiClient);

const keys = {
  publicShare: (pageId: string) => ["publicShare", pageId] as const,
};

/** Current publish settings for a page (null if never published). */
export function usePublicShare(pageId: string) {
  return useQuery({
    queryKey: keys.publicShare(pageId),
    queryFn: () => api.getPublicShare(pageId),
  });
}

/** Publish (or re-publish) a page; refreshes the cached settings. */
export function usePublishPage(pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PublishPageInput) => api.publish(pageId, body),
    onSuccess: (settings) => qc.setQueryData(keys.publicShare(pageId), settings),
  });
}

/** Unpublish a page; invalidates the cached settings. */
export function useUnpublishPage(pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.unpublish(pageId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.publicShare(pageId) }),
  });
}
