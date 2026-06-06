import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BacklinksPanel } from "../src/pages/BacklinksPanel";
import type { Backlink } from "../src/api/types";

afterEach(cleanup);

const backlinks: Backlink[] = [
  { id: "a", title: "Page A", icon: "📘" },
  { id: "b", title: "", icon: null },
];

describe("BacklinksPanel", () => {
  it("renders the backlinks from a (mocked) query result", () => {
    render(<BacklinksPanel backlinks={backlinks} onOpenPage={() => {}} />);

    expect(screen.getByTestId("backlinks-panel")).toBeInTheDocument();
    expect(screen.getByText("Page A")).toBeInTheDocument();
    // Blank title falls back to Untitled.
    expect(screen.getByText("Untitled")).toBeInTheDocument();
    // Count badge reflects the number of inbound references.
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("calls onOpenPage with the page id when a backlink is clicked", () => {
    const onOpenPage = vi.fn();
    render(<BacklinksPanel backlinks={backlinks} onOpenPage={onOpenPage} />);

    fireEvent.click(screen.getByText("Page A"));
    expect(onOpenPage).toHaveBeenCalledWith("a");
  });

  it("renders nothing when there are no backlinks", () => {
    const { container } = render(<BacklinksPanel backlinks={[]} onOpenPage={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a loading state while the query is pending", () => {
    render(<BacklinksPanel backlinks={[]} onOpenPage={() => {}} loading />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });
});
