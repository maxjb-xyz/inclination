import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("flushes a pending edit to the page it was typed in when pageId changes", async () => {
    // Regression for M1: typing into page A then switching to page B before the
    // debounce fires must commit A's content to A's id — never to B.
    const onSave = vi.fn<(doc: Record<string, unknown>, pageId: string) => void>();
    const user = userEvent.setup();

    const { rerender } = render(
      <Editor pageId="A" initialDoc={emptyDoc} onSave={onSave} debounceMs={600} />,
    );

    // Type into page A's editor surface.
    const surface = screen.getByTestId("editor");
    const editable = surface.querySelector(".ProseMirror") as HTMLElement;
    editable.focus();
    // skipClick avoids ProseMirror's mousedown -> posAtCoords path, which needs
    // real layout coords that jsdom cannot provide.
    await user.type(editable, "hello from A", { skipClick: true });

    // An edit is pending in the debounce but has NOT fired yet.
    expect(onSave).not.toHaveBeenCalled();

    // Switch to page B before the debounce window elapses.
    await act(async () => {
      rerender(<Editor pageId="B" initialDoc={emptyDoc} onSave={onSave} debounceMs={600} />);
    });

    // The pending save was flushed on the page change (nothing was dropped)...
    expect(onSave).toHaveBeenCalledTimes(1);
    // ...and it targeted page A's id, carrying A's typed content (not page B).
    const [savedDoc, savedPageId] = onSave.mock.calls[0]!;
    expect(savedPageId).toBe("A");
    expect(JSON.stringify(savedDoc)).toContain("hello from A");
  });
});
