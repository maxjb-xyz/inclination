import type {
  CreateDatabaseInput,
  CreatePropertyInput,
  CreateRowInput,
  CreateViewInput,
  QueryRowsInput,
  RelationLinkInput,
  ReorderPropertiesInput,
  UpdateDatabaseInput,
  UpdatePropertyInput,
  UpdateViewInput,
} from "@inclination/shared";
import type { ApiClient } from "../api/apiClient";
import type {
  CellValue,
  Database,
  Property,
  QueryRowsResult,
  RowPage,
  SetCellResult,
  View,
} from "./dbTypes";

/**
 * Typed wrappers over the Phase-5 database REST surface
 * (apps/api/src/databases/databases.controller.ts). Parameterised by an
 * `ApiClient` so it can be unit-tested against a mocked client, matching the
 * `createPagesApi` pattern.
 */
export function createDbApi(client: ApiClient) {
  return {
    // ── Database ──────────────────────────────────────────────
    createDatabase: (wsId: string, input: CreateDatabaseInput = {}) =>
      client.post<Database>(`/workspaces/${wsId}/databases`, input),
    getDatabase: (id: string) => client.get<Database>(`/databases/${id}`),
    updateDatabase: (id: string, input: UpdateDatabaseInput) =>
      client.patch<Database>(`/databases/${id}`, input),
    convertToDatabase: (pageId: string) =>
      client.post<Database>(`/pages/${pageId}/convert-to-database`),

    // ── Properties ────────────────────────────────────────────
    createProperty: (databaseId: string, input: CreatePropertyInput) =>
      client.post<Property>(`/databases/${databaseId}/properties`, input),
    updateProperty: (propertyId: string, input: UpdatePropertyInput) =>
      client.patch<Property>(`/properties/${propertyId}`, input),
    reorderProperties: (databaseId: string, input: ReorderPropertiesInput) =>
      client.post<Property[]>(`/databases/${databaseId}/properties/reorder`, input),
    deleteProperty: (propertyId: string) =>
      client.del<{ deleted: number }>(`/properties/${propertyId}`),

    // ── Views ─────────────────────────────────────────────────
    createView: (databaseId: string, input: CreateViewInput) =>
      client.post<View>(`/databases/${databaseId}/views`, input),
    updateView: (viewId: string, input: UpdateViewInput) =>
      client.patch<View>(`/views/${viewId}`, input),
    deleteView: (viewId: string) => client.del<{ deleted: number }>(`/views/${viewId}`),
    setDefaultView: (viewId: string) =>
      client.post<{ defaultViewId: string }>(`/views/${viewId}/default`),

    // ── Rows + cells ──────────────────────────────────────────
    createRow: (databaseId: string, input: CreateRowInput = {}) =>
      client.post<RowPage>(`/databases/${databaseId}/rows`, input),
    listRows: (databaseId: string) => client.get<RowPage[]>(`/databases/${databaseId}/rows`),
    setCell: (rowId: string, propertyId: string, value: CellValue) =>
      client.put<SetCellResult>(`/rows/${rowId}/cells/${propertyId}`, { value }),

    // ── Relations ─────────────────────────────────────────────
    linkRelation: (propertyId: string, input: RelationLinkInput) =>
      client.post<{ linked: boolean }>(`/properties/${propertyId}/links`, input),
    // DELETE /links carries a body (the link to remove), so use `request` rather
    // than `del` which sends no body.
    unlinkRelation: (propertyId: string, input: RelationLinkInput) =>
      client.request<{ unlinked: boolean }>(`/properties/${propertyId}/links`, {
        method: "DELETE",
        body: input,
      }),

    // ── Query (drives all views) ──────────────────────────────
    query: (databaseId: string, input: QueryRowsInput = {}) =>
      client.post<QueryRowsResult>(`/databases/${databaseId}/query`, input),
  };
}

export type DbApi = ReturnType<typeof createDbApi>;
