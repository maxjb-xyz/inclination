import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { useAuthStore } from "../src/auth/authStore";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null, tokens: null });
  localStorage.clear();
});

describe("App (logged out)", () => {
  it("renders the product name and auth tabs", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Inclination" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Register" })).toBeInTheDocument();
  });
});

describe("RegisterForm", () => {
  it("shows a validation error for a short password and does not call the API", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Register" }));
    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Display name"), "Alice");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/at least 10/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("LoginForm", () => {
  it("stores the session and shows the signed-in user on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            user: {
              id: "u1",
              email: "a@b.com",
              displayName: "Alice",
              avatarUrl: null,
              emailVerified: true,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
            tokens: { accessToken: "at", refreshToken: "rt" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Password"), "ownerpassword1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(screen.getByTestId("current-user")).toHaveTextContent("Signed in as Alice"),
    );
    expect(useAuthStore.getState().tokens?.accessToken).toBe("at");
  });
});
