import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 })),
    );
  });

  it("renders the product name", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Inclination" })).toBeInTheDocument();
  });

  it("reflects API health once the health check resolves", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("api-status")).toHaveTextContent("ok"));
  });
});
