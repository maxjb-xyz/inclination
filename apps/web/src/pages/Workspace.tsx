import { useCallback, useEffect, useMemo, useState } from "react";
import type { projectMove } from "./projectMove";
import { Sidebar } from "./Sidebar";
import { PageView } from "./PageView";
import { TrashView } from "./TrashView";
import { CommandPalette } from "./CommandPalette";
import { NotificationsBell } from "../collab/NotificationsBell";
import { useShortcuts } from "../shortcuts/useShortcuts";
import type { Shortcut } from "../shortcuts/shortcuts";
import { ShortcutsHelp } from "../shortcuts/ShortcutsHelp";
import { useThemeStore } from "../theme/themeStore";
import { apiClient } from "../api/apiClient";
import { createPublishingApi } from "../api/publishingApi";
import {
  useArchivePage,
  useCreatePage,
  useCreateWorkspace,
  useMovePage,
  usePageTree,
  useWorkspaces,
} from "./queries";
import { queryKeys } from "./queries";
import { useQueryClient } from "@tanstack/react-query";

const publishingApi = createPublishingApi(apiClient);

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
  const qc = useQueryClient();
  const pages = tree.data ?? [];
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Sidebar visibility. On narrow viewports it overlays and starts closed;
  // on wide viewports CSS keeps it in flow regardless of this flag.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const cycleTheme = useThemeStore((s) => s.cycle);

  // Import a Markdown file → create a page tree → refetch the sidebar tree and
  // open the created root page.
  const importMarkdown = useCallback(
    async (filename: string, markdown: string): Promise<void> => {
      const root = await publishingApi.importMarkdown(workspaceId, filename, markdown);
      await qc.invalidateQueries({ queryKey: queryKeys.tree(workspaceId) });
      setView({ kind: "page", id: root.id });
    },
    [workspaceId, qc, setView],
  );

  const openPage = useCallback((id: string): void => {
    setView({ kind: "page", id });
  }, [setView]);

  const createRoot = useCallback((): void => {
    createPage.mutate({}, { onSuccess: (p) => setView({ kind: "page", id: p.id }) });
  }, [createPage, setView]);

  const openTrash = useCallback((): void => {
    setView({ kind: "trash" });
  }, [setView]);

  // Keyboard shortcuts. ⌘K is global (fires even inside the editor); the rest
  // are suppressed while typing in an editable surface (see useShortcuts).
  const shortcuts = useMemo<Shortcut[]>(
    () => [
      {
        id: "palette",
        key: "k",
        meta: true,
        global: true,
        description: "Open the command palette",
        run: () => setPaletteOpen((o) => !o),
      },
      {
        id: "toggle-sidebar",
        key: "\\",
        meta: true,
        description: "Toggle the sidebar",
        run: () => setSidebarOpen((o) => !o),
      },
      {
        id: "toggle-theme",
        key: "l",
        meta: true,
        shift: true,
        description: "Cycle the theme (light / dark / system)",
        run: () => cycleTheme(),
      },
      {
        id: "new-page",
        key: "n",
        meta: true,
        description: "Create a new page",
        run: () => createRoot(),
      },
      {
        id: "help",
        key: "?",
        global: true,
        description: "Show keyboard shortcuts",
        run: () => setHelpOpen((o) => !o),
      },
    ],
    [cycleTheme, createRoot],
  );
  useShortcuts(shortcuts);

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

  // On selection, close the (overlay) sidebar on narrow screens.
  const selectAndClose = useCallback(
    (id: string): void => {
      openPage(id);
      setSidebarOpen(false);
    },
    [openPage],
  );

  return (
    <div className={`workspace${sidebarOpen ? " sidebar-open" : ""}`}>
      {sidebarOpen ? (
        <button
          type="button"
          className="sidebar-scrim"
          data-testid="sidebar-scrim"
          aria-label="Close sidebar"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      <Sidebar
        pages={pages}
        activePageId={view.kind === "page" ? view.id : null}
        onSelect={selectAndClose}
        onCreateRoot={createRoot}
        onCreateChild={createChild}
        onArchive={archive}
        onMove={move}
        onOpenTrash={() => setView({ kind: "trash" })}
        onImport={importMarkdown}
      />
      <main className="workspace-main">
        <div className="workspace-topbar">
          <button
            type="button"
            className="sidebar-toggle"
            data-testid="sidebar-toggle"
            aria-label="Toggle sidebar"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((o) => !o)}
          >
            ☰
          </button>
          <button
            type="button"
            className="quick-switcher-trigger"
            data-testid="open-command-palette"
            onClick={() => setPaletteOpen(true)}
          >
            🔍 Search… <kbd>⌘K</kbd>
          </button>
          <span className="spacer" />
          <button
            type="button"
            className="shortcuts-trigger"
            data-testid="open-shortcuts"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            onClick={() => setHelpOpen(true)}
          >
            ?
          </button>
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
      {helpOpen ? (
        <ShortcutsHelp shortcuts={shortcuts} onClose={() => setHelpOpen(false)} />
      ) : null}
    </div>
  );
}
