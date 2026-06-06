import { useRestorePage, useTrash } from "./queries";

export interface TrashViewProps {
  workspaceId: string;
  onClose: () => void;
}

export function TrashView({ workspaceId, onClose }: TrashViewProps): React.ReactElement {
  const trash = useTrash(workspaceId);
  const restore = useRestorePage(workspaceId);
  const pages = trash.data ?? [];

  return (
    <div className="trash-view">
      <header className="page-header">
        <h2>Trash</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>
      {trash.isLoading ? (
        <p>Loading…</p>
      ) : pages.length === 0 ? (
        <p>Trash is empty.</p>
      ) : (
        <ul className="trash-list">
          {pages.map((p) => (
            <li key={p.id} data-testid="trash-row">
              <span className="page-icon">{p.icon ?? "\u{1F4C4}"}</span>
              <span className="page-title">{p.title || "Untitled"}</span>
              <button type="button" onClick={() => restore.mutate(p.id)} aria-label="Restore page">
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
