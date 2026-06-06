import { createContext, useContext } from "react";

/**
 * Context for the inline `databaseView` NodeView: it needs the active workspace
 * id (to render the embedded {@link DatabaseView}) and a way to create a new
 * database on demand (for the "Database - inline" slash action, which inserts an
 * empty node and then fills in the created database id).
 */
export interface DatabaseEditorContextValue {
  workspaceId: string;
  /** Create a new database under the current page; resolves to its id. */
  createDatabase: () => Promise<string>;
}

export const DatabaseEditorContext = createContext<DatabaseEditorContextValue | null>(null);

export function useDatabaseEditorContext(): DatabaseEditorContextValue | null {
  return useContext(DatabaseEditorContext);
}
