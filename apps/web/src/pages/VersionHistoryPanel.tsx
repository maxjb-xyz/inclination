import { useState } from "react";
import { apiClient } from "../api/apiClient";
import { createPagesApi } from "../api/pagesApi";
import type { SnapshotContent } from "../api/types";
import { useSnapshots, useCreateSnapshot, useRestoreSnapshot } from "./queries";

const api = createPagesApi(apiClient);

export interface VersionHistoryPanelProps {
  pageId: string;
  /** Gate Save / Restore on the page's write capability. */
  canWrite: boolean;
  onClose: () => void;
}

/** Format an ISO timestamp for the snapshot list (locale-friendly, terse). */
function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * Version-history drawer for a page: lists {@link Snapshot}s (author/time/label),
 * a "Save version" button (manual snapshot), a read-only preview of a selected
 * snapshot's plaintext, and a Restore button. Save/Restore are hidden when the
 * user lacks write access. Restore refetches the page so the restored content
 * surfaces.
 */
export function VersionHistoryPanel({
  pageId,
  canWrite,
  onClose,
}: VersionHistoryPanelProps): React.ReactElement {
  const snapshots = useSnapshots(pageId);
  const createSnapshot = useCreateSnapshot(pageId);
  const restoreSnapshot = useRestoreSnapshot(pageId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<SnapshotContent | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  async function openPreview(snapId: string): Promise<void> {
    setSelectedId(snapId);
    setPreview(null);
    setPreviewLoading(true);
    try {
      const content = await api.getSnapshot(pageId, snapId);
      setPreview(content);
    } finally {
      setPreviewLoading(false);
    }
  }

  const list = snapshots.data ?? [];

  return (
    <aside className="version-panel" data-testid="version-panel" aria-label="Version history">
      <header className="version-panel__header">
        <h2>Version history</h2>
        <div className="version-panel__actions">
          {canWrite ? (
            <button
              type="button"
              data-testid="version-save"
              disabled={createSnapshot.isPending}
              onClick={() => createSnapshot.mutate(undefined)}
            >
              {createSnapshot.isPending ? "Saving…" : "Save version"}
            </button>
          ) : null}
          <button type="button" data-testid="version-close" onClick={onClose}>
            Close
          </button>
        </div>
      </header>

      <ul className="version-panel__list">
        {snapshots.isLoading ? <li className="version-panel__hint">Loading…</li> : null}
        {!snapshots.isLoading && list.length === 0 ? (
          <li className="version-panel__hint" data-testid="version-empty">
            No saved versions yet
          </li>
        ) : null}
        {list.map((s) => (
          <li
            key={s.id}
            className={`version-item${selectedId === s.id ? " is-active" : ""}`}
            data-testid="version-item"
          >
            <button
              type="button"
              className="version-item__select"
              data-testid="version-item-select"
              onClick={() => void openPreview(s.id)}
            >
              <span className="version-item__label">{s.label || "Untitled version"}</span>
              <span className="version-item__meta">{fmt(s.createdAt)}</span>
            </button>
            {canWrite ? (
              <button
                type="button"
                className="version-item__restore"
                data-testid="version-restore"
                disabled={restoreSnapshot.isPending}
                onClick={() => restoreSnapshot.mutate(s.id)}
              >
                {restoreSnapshot.isPending ? "Restoring…" : "Restore"}
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {selectedId ? (
        <div className="version-panel__preview" data-testid="version-preview">
          {previewLoading ? (
            <p className="version-panel__hint">Loading preview…</p>
          ) : (
            <pre className="version-preview__text">{preview?.text ?? ""}</pre>
          )}
        </div>
      ) : null}
    </aside>
  );
}
