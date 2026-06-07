import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useState } from "react";
import { DatabaseView } from "../databases/DatabaseView";
import { useOpenPage } from "./openPageContext";
import { useDatabaseEditorContext } from "./databaseContext";

/**
 * React NodeView for the inline/linked `databaseView` block.
 *
 *  - With a `databaseId`, it renders the embedded {@link DatabaseView} (inline
 *    frame). For a linked view (`linked: true`), it also offers a link to open
 *    the source database page.
 *  - Without a `databaseId`, it offers a button to create a new inline database
 *    (used when the slash action inserts an empty node) — the created id is then
 *    written into the node attrs.
 */
export function DatabaseNodeView({
  node,
  updateAttributes,
  editor,
}: NodeViewProps): React.ReactElement {
  const databaseId = (node.attrs.databaseId as string | null) ?? null;
  const linked = Boolean(node.attrs.linked);
  const ctx = useDatabaseEditorContext();
  const openPage = useOpenPage();
  const [creating, setCreating] = useState(false);

  if (!databaseId) {
    return (
      <NodeViewWrapper className="db-node db-node--empty" data-testid="database-node">
        <button
          type="button"
          data-testid="database-node-create"
          disabled={!ctx || creating || !editor.isEditable}
          onClick={async () => {
            if (!ctx) return;
            setCreating(true);
            try {
              const id = await ctx.createDatabase();
              updateAttributes({ databaseId: id, linked: false });
            } finally {
              setCreating(false);
            }
          }}
        >
          {creating ? "Creating…" : "+ Create inline database"}
        </button>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      className={`db-node${linked ? " db-node--linked" : ""}`}
      data-testid="database-node"
      data-database-id={databaseId}
    >
      {linked ? (
        <div className="db-node__linkbar">
          <button type="button" className="db-node__open" onClick={() => openPage(databaseId)}>
            Open source ↗
          </button>
        </div>
      ) : null}
      {ctx ? (
        <DatabaseView databaseId={databaseId} workspaceId={ctx.workspaceId} inline />
      ) : (
        <p className="db-node__error">Database context unavailable.</p>
      )}
    </NodeViewWrapper>
  );
}
