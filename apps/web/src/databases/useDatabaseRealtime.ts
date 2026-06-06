import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../auth/authStore";
import { realtimeClient } from "./realtime";
import { patchQueryResult, type DatabaseEvent } from "./realtimeReducer";
import { dbKeys, invalidateDatabase } from "./queries";
import type { QueryRowsResult } from "./dbTypes";

/**
 * Subscribe an open database view to live updates. On each `database:event` for
 * this database (that this user did NOT cause — local mutations are optimistic),
 * patch every cached query result in place via {@link patchQueryResult}; when an
 * event can't be patched in place (row add/remove, structural change), invalidate
 * the database so it refetches.
 */
export function useDatabaseRealtime(databaseId: string | null): void {
  const qc = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  useEffect(() => {
    if (!databaseId) return;

    const onEvent = (event: DatabaseEvent): void => {
      if (event.databaseId !== databaseId) return;
      // Ignore our own echo — the optimistic local update is authoritative.
      if (event.actorId && event.actorId === currentUserId) return;

      const entries = qc.getQueriesData<QueryRowsResult>({
        queryKey: dbKeys.queryAll(databaseId),
      });
      let needsRefetch = false;
      for (const [key, data] of entries) {
        const patched = patchQueryResult(data, event);
        if (patched === null) {
          needsRefetch = true;
        } else if (patched !== data) {
          qc.setQueryData<QueryRowsResult>(key, patched);
        }
      }
      if (needsRefetch) invalidateDatabase(qc, databaseId);
    };

    return realtimeClient.subscribe(databaseId, onEvent);
  }, [databaseId, currentUserId, qc]);
}
