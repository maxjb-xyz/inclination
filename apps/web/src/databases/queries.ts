import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  CreatePropertyInput,
  CreateRowInput,
  CreateViewInput,
  QueryRowsInput,
  UpdatePropertyInput,
  UpdateViewInput,
} from "@inclination/shared";
import { apiClient } from "../api/apiClient";
import { createDbApi } from "./dbApi";
import type { CellValue, Database, QueryRowsResult } from "./dbTypes";

const api = createDbApi(apiClient);

export const dbKeys = {
  database: (id: string) => ["database", id] as const,
  query: (id: string, viewId: string | undefined) =>
    ["database", id, "query", viewId ?? "ad-hoc"] as const,
  /** Prefix matching every query result for a database (for invalidation). */
  queryAll: (id: string) => ["database", id, "query"] as const,
};

export function useDatabase(id: string | null) {
  return useQuery({
    queryKey: id ? dbKeys.database(id) : ["database", "none"],
    queryFn: () => api.getDatabase(id as string),
    enabled: Boolean(id),
  });
}

export function useDatabaseQuery(databaseId: string | null, input: QueryRowsInput = {}) {
  return useQuery({
    queryKey: databaseId
      ? dbKeys.query(databaseId, input.viewId)
      : ["database", "none", "query"],
    queryFn: () => api.query(databaseId as string, input),
    enabled: Boolean(databaseId),
  });
}

/** Invalidate everything for a database (structure + every view's rows). */
export function invalidateDatabase(qc: QueryClient, databaseId: string): void {
  void qc.invalidateQueries({ queryKey: dbKeys.database(databaseId) });
  void qc.invalidateQueries({ queryKey: dbKeys.queryAll(databaseId) });
}

export function useCreateRow(databaseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRowInput = {}) => api.createRow(databaseId, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: dbKeys.queryAll(databaseId) }),
  });
}

export function useCreateProperty(databaseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePropertyInput) => api.createProperty(databaseId, input),
    onSuccess: () => invalidateDatabase(qc, databaseId),
  });
}

export function useUpdateProperty(databaseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePropertyInput }) =>
      api.updateProperty(id, input),
    onSuccess: () => invalidateDatabase(qc, databaseId),
  });
}

export function useDeleteProperty(databaseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteProperty(id),
    onSuccess: () => invalidateDatabase(qc, databaseId),
  });
}

export function useCreateView(databaseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateViewInput) => api.createView(databaseId, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: dbKeys.database(databaseId) }),
  });
}

export function useUpdateView(databaseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateViewInput }) =>
      api.updateView(id, input),
    onSuccess: () => invalidateDatabase(qc, databaseId),
  });
}

export function useDeleteView(databaseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteView(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: dbKeys.database(databaseId) }),
  });
}

/**
 * Optimistic cell edit: patches every cached query result for the database, PUTs
 * the cell, and rolls back on error. The realtime hook ignores the echo for the
 * acting user so the optimistic value is authoritative locally.
 */
export function useSetCell(databaseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      rowId,
      propertyId,
      value,
    }: {
      rowId: string;
      propertyId: string;
      value: CellValue;
    }) => api.setCell(rowId, propertyId, value),
    onMutate: async ({ rowId, propertyId, value }) => {
      await qc.cancelQueries({ queryKey: dbKeys.queryAll(databaseId) });
      const prev = qc.getQueriesData<QueryRowsResult>({
        queryKey: dbKeys.queryAll(databaseId),
      });
      for (const [key, data] of prev) {
        if (!data) continue;
        qc.setQueryData<QueryRowsResult>(key, {
          ...data,
          rows: data.rows.map((row) =>
            row.pageId === rowId
              ? { ...row, cells: { ...row.cells, [propertyId]: value } }
              : row,
          ),
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, data] of ctx?.prev ?? []) {
        qc.setQueryData(key, data);
      }
    },
    // Computed values (rollups/formulas/last_edited) may have changed; refresh.
    onSettled: () => void qc.invalidateQueries({ queryKey: dbKeys.queryAll(databaseId) }),
  });
}

/** Read a database from the cache (used by the realtime hook for actor checks). */
export function getCachedDatabase(qc: QueryClient, databaseId: string): Database | undefined {
  return qc.getQueryData<Database>(dbKeys.database(databaseId));
}
