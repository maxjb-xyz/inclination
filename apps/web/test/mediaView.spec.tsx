import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NodeViewProps } from "@tiptap/react";
import { MediaView } from "../src/editor/MediaView";

afterEach(cleanup);

/** Build minimal NodeViewProps for MediaView (it only reads a few fields). */
function makeProps(
  typeName: string,
  attrs: Record<string, unknown>,
  updateAttributes = vi.fn(),
): NodeViewProps {
  return {
    node: { type: { name: typeName }, attrs },
    updateAttributes,
    editor: { isEditable: true },
  } as unknown as NodeViewProps;
}

describe("MediaView render-time guard", () => {
  it("renders a safe https URL as an href", () => {
    render(<MediaView {...makeProps("bookmark", { src: "https://example.com", title: "" })} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://example.com");
  });

  it("renders a safe https video URL as a video src", () => {
    const { container } = render(
      <MediaView {...makeProps("videoBlock", { src: "https://example.com/v.mp4", title: "" })} />,
    );
    const video = container.querySelector("video");
    expect(video).toHaveAttribute("src", "https://example.com/v.mp4");
  });

  it("renders a safe https embed URL as an iframe src", () => {
    const { container } = render(
      <MediaView {...makeProps("embed", { src: "https://example.com/e", title: "" })} />,
    );
    const iframe = container.querySelector("iframe");
    expect(iframe).toHaveAttribute("src", "https://example.com/e");
  });

  it("blocks a javascript: URL (no href/src, shows placeholder)", () => {
    const { container } = render(
      <MediaView {...makeProps("bookmark", { src: "javascript:alert(1)", title: "" })} />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector("[href]")).toBeNull();
    expect(screen.getByTestId("media-bookmark-blocked")).toBeInTheDocument();
  });

  it("blocks a data:text/html iframe src (no src, shows placeholder)", () => {
    const { container } = render(
      <MediaView
        {...makeProps("embed", { src: "data:text/html,<script>alert(1)</script>", title: "" })}
      />,
    );
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByTestId("media-embed-blocked")).toBeInTheDocument();
  });
});

describe("MediaView commit-time guard", () => {
  it("does not store an unsafe URL and shows an inline error", () => {
    const updateAttributes = vi.fn();
    render(<MediaView {...makeProps("fileBlock", { src: "" }, updateAttributes)} />);

    const input = screen.getByLabelText("file URL");
    fireEvent.change(input, { target: { value: "javascript:alert(1)" } });
    fireEvent.submit(input.closest("form")!);

    expect(updateAttributes).not.toHaveBeenCalled();
    expect(screen.getByTestId("media-file-error")).toHaveTextContent(/only http\(s\)/i);
  });

  it("stores a safe https URL on commit", () => {
    const updateAttributes = vi.fn();
    render(<MediaView {...makeProps("fileBlock", { src: "" }, updateAttributes)} />);

    const input = screen.getByLabelText("file URL");
    fireEvent.change(input, { target: { value: "https://example.com/f.pdf" } });
    fireEvent.submit(input.closest("form")!);

    // Committing a URL also clears any stale attachmentId (URL takes over).
    expect(updateAttributes).toHaveBeenCalledWith({
      src: "https://example.com/f.pdf",
      attachmentId: null,
    });
  });
});
