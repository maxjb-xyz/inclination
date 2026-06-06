import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { CollabSession } from "../src/collab/session";
import { Editor } from "../src/pages/Editor";

// A minimal fake Hocuspocus provider satisfying CollaborationCursor's needs
// (an `awareness` with the expected event surface). No socket is opened.
function makeFakeSession(): CollabSession {
  const doc = new Y.Doc();
  const awareness = {
    setLocalStateField: () => {},
    getLocalState: () => ({}),
    getStates: () => new Map(),
    on: () => {},
    off: () => {},
    states: new Map(),
  };
  const provider = { awareness, document: doc } as unknown as CollabSession["provider"];
  return {
    pageId: "p1",
    doc,
    provider,
    persistence: {} as CollabSession["persistence"],
    destroy: () => {},
  };
}

afterEach(cleanup);

describe("Editor (full block set)", () => {
  it("mounts the collaborative editor with the block extensions", () => {
    const session = makeFakeSession();
    render(
      <Editor
        session={session}
        user={{ name: "Alice", color: "#abcdef" }}
        workspaceId="ws1"
        onOpenPage={() => {}}
      />,
    );

    const root = screen.getByTestId("editor");
    expect(root).toBeInTheDocument();
    // The ProseMirror editable surface is present (editor built successfully).
    expect(root.querySelector(".ProseMirror")).not.toBeNull();
  });
});
