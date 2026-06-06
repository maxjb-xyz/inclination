import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useState } from "react";
import { renderEquation } from "@inclination/editor";

/**
 * React NodeView for the `equation` block: renders the stored LaTeX with KaTeX
 * (via the package's `renderEquation`) and lets the user edit the source inline.
 * Empty equations show an editable prompt.
 */
export function EquationView({ node, updateAttributes, editor }: NodeViewProps): React.ReactElement {
  const latex = (node.attrs.latex as string) ?? "";
  const [editing, setEditing] = useState(latex.length === 0);
  const [draft, setDraft] = useState(latex);

  const commit = (): void => {
    updateAttributes({ latex: draft });
    setEditing(false);
  };

  return (
    <NodeViewWrapper className="equation-block" data-testid="equation-block">
      {editing || !editor.isEditable ? null : (
        <div
          className="equation-render"
          onClick={() => editor.isEditable && setEditing(true)}
          dangerouslySetInnerHTML={{ __html: renderEquation(latex) }}
        />
      )}
      {editing && editor.isEditable ? (
        <div className="equation-editor">
          <textarea
            className="equation-input"
            aria-label="LaTeX equation"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
            }}
            placeholder="E = mc^2"
          />
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}
