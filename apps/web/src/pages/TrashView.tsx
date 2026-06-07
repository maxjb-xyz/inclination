import { RotateCcw, Trash2, X } from "lucide-react";
import { Button, EmptyState, IconButton, Spinner } from "../ui";
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
      <header className="trash-view__header">
        <h2 className="trash-view__title">
          <Trash2 size={18} /> Trash
        </h2>
        <IconButton label="Close" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </header>
      {trash.isLoading ? (
        <div className="trash-view__loading">
          <Spinner /> Loading…
        </div>
      ) : pages.length === 0 ? (
        <EmptyState
          icon={<Trash2 size={22} />}
          title="Trash is empty"
          description="Pages you delete will appear here, ready to restore."
        />
      ) : (
        <ul className="trash-list">
          {pages.map((p) => (
            <li key={p.id} data-testid="trash-row">
              <span className="page-icon">{p.icon ?? "\u{1F4C4}"}</span>
              <span className="page-title">{p.title || "Untitled"}</span>
              <Button
                size="sm"
                icon={<RotateCcw size={14} />}
                onClick={() => restore.mutate(p.id)}
                aria-label="Restore page"
              >
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
