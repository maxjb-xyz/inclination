import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "../src/pages/Editor";

afterEach(cleanup);

const emptyDoc = { type: "doc", content: [{ type: "paragraph" }] };

describe("Editor", () => {
  it("mounts the Tiptap editor surface with the loaded doc", () => {
    render(<Editor pageId="p1" initialDoc={emptyDoc} onSave={vi.fn()} />);
    // The editor container is present and Tiptap mounts a contenteditable.
    const surface = screen.getByTestId("editor");
    expect(surface).toBeInTheDocument();
    expect(surface.querySelector(".ProseMirror")).not.toBeNull();
  });

  it("does not call onSave on initial render (only on user edits)", () => {
    const onSave = vi.fn();
    render(<Editor pageId="p1" initialDoc={emptyDoc} onSave={onSave} debounceMs={10} />);
    expect(onSave).not.toHaveBeenCalled();
  });
});
