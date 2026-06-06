import { useCallback, useEffect, useState } from "react";
import type { projectMove } from "./projectMove";
import { Sidebar } from "./Sidebar";
import { PageView } from "./PageView";
import { TrashView } from "./TrashView";
import { CommandPalette } from "./CommandPalette";
import { NotificationsBell } from "../collab/NotificationsBell";
import {
  useArchivePage,
  useCreatePage,
  useCreateWorkspace,
  useMovePage,
  usePageTree,
  useWorkspaces,
} from "./queries";

type View = { kind: "page"; id: string } | { kind: "trash" } | { kind: "empty" };

export function Workspace(): React.ReactElement {
  const workspaces = useWorkspaces();
  const createWorkspace = useCreateWorkspace();
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "empty" });

  // Bootstrap: pick the first workspace, or create a default one if none exist.
  useEffect(() => {
    if (!workspaces.isSuccess) return;
    const list = workspaces.data;
    const first = list[0];
    if (first) {
      setActiveWorkspaceId((cur) => cur ?? first.id);
    } else if (!createWorkspace.isPending && createWorkspace.isIdle) {
      createWorkspace.mutate("My Workspace", {
        onSuccess: (ws) => setActiveWorkspaceId(ws.id),
      });
    }
  }, [workspaces.isSuccess, workspaces.data, createWorkspace]);

  if (workspaces.isLoading || !activeWorkspaceId) {
    return <div className="workspace-loading">Setting up your workspace…</div>;
  }

  return <WorkspaceShell workspaceId={activeWorkspaceId} view={view} setView={setView} />;
}

function WorkspaceShell({
  workspaceId,
  view,
  setView,
}: {
  workspaceId: string;
  view: View;
  setView: (v: View) => void;
}): React.ReactElement {
  const tree = usePageTree(workspaceId);
  const createPage = useCreatePage(workspaceId);
  const archivePage = useArchivePage(workspaceId);
  const movePage = useMovePage(workspaceId);
  const pages = tree.data ?? [];
  const [paletteOpen, setPaletteOpen] = useState(false);

  const openPage = useCallback((id: string): void => {
    setView({ kind: "page", id });
  }, [setView]);

  const createRoot = useCallback((): void => {
    createPage.mutate({}, { onSuccess: (p) => setView({ kind: "page", id: p.id }) });
  }, [createPage, setView]);

  const openTrash = useCallback((): void => {
    setView({ kind: "trash" });
  }, [setView]);

  // Global ⌘K / Ctrl+K toggles the command palette from any page.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function createChild(parentId: string): void {
    createPage.mutate({ parentId }, { onSuccess: (p) => setView({ kind: "page", id: p.id }) });
  }

  function archive(id: string): void {
    archivePage.mutate(id, {
      onSuccess: () => {
        if (view.kind === "page" && view.id === id) setView({ kind: "empty" });
      },
    });
  }

  function move(id: string, plan: ReturnType<typeof projectMove>): void {
    if (!plan) return;
    movePage.mutate({ id, input: plan.input });
  }

  return (
    <div className="workspace">
      <Sidebar
        pages={pages}
        activePageId={view.kind === "page" ? view.id : null}
        onSelect={openPage}
        onCreateRoot={createRoot}
        onCreateChild={createChild}
        onArchive={archive}
        onMove={move}
        onOpenTrash={() => setView({ kind: "trash" })}
      />
      <main className="workspace-main">
        <div className="workspace-topbar">
          <button
            type="button"
            className="quick-switcher-trigger"
            data-testid="open-command-palette"
            onClick={() => setPaletteOpen(true)}
          >
            🔍 Search… <kbd>⌘K</kbd>
          </button>
          <span className="spacer" />
          <NotificationsBell onOpenPage={openPage} />
        </div>
        {view.kind === "page" ? (
          <PageView workspaceId={workspaceId} pageId={view.id} onNavigate={openPage} />
        ) : view.kind === "trash" ? (
          <TrashView workspaceId={workspaceId} onClose={() => setView({ kind: "empty" })} />
        ) : (
          <div className="empty-state">
            <p>Select a page or create a new one.</p>
            <button type="button" onClick={createRoot}>
              + New page
            </button>
          </div>
        )}
      </main>
      {paletteOpen ? (
        <CommandPalette
          workspaceId={workspaceId}
          onClose={() => setPaletteOpen(false)}
          onOpenPage={openPage}
          onNewPage={createRoot}
          onOpenTrash={openTrash}
        />
      ) : null}
    </div>
  );
}
