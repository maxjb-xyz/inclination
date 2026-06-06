import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, type SessionStore } from "../src/api/apiClient";
import type { Tokens } from "../src/auth/authClient";
import type { PublicUser } from "../src/auth/types";

const user: PublicUser = {
  id: "u1",
  email: "a@b.com",
  displayName: "Alice",
  avatarUrl: null,
  emailVerified: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function makeStore(initial: Tokens | null): SessionStore & { tokens: Tokens | null } {
  const state = { tokens: initial, user: initial ? user : null as PublicUser | null };
  return {
    get tokens() {
      return state.tokens;
    },
    getTokens: () => state.tokens,
    getUser: () => state.user,
    setSession: (u, t) => {
      state.user = u;
      state.tokens = t;
    },
    clear: () => {
      state.user = null;
      state.tokens = null;
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("apiClient", () => {
  it("attaches the bearer token and returns the parsed body", async () => {
    const store = makeStore({ accessToken: "at", refreshToken: "rt" });
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse([{ id: "ws1" }]),
    );
    const client = createApiClient(store, fetchMock as unknown as typeof fetch);

    const result = await client.get<{ id: string }[]>("/workspaces");

    expect(result).toEqual([{ id: "ws1" }]);
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer at" });
  });

  it("on 401 refreshes the token, updates the store, and retries once", async () => {
    const store = makeStore({ accessToken: "stale", refreshToken: "rt" });
    const fetchMock = vi
      .fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      // 1) initial request -> 401
      .mockResolvedValueOnce(jsonResponse({ message: "expired" }, 401))
      // 2) refresh -> new tokens
      .mockResolvedValueOnce(jsonResponse({ tokens: { accessToken: "fresh", refreshToken: "rt2" } }))
      // 3) retry -> ok
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = createApiClient(store, fetchMock as unknown as typeof fetch);

    const result = await client.get<{ ok: boolean }>("/pages/x");

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // store updated with refreshed tokens
    expect(store.getTokens()).toEqual({ accessToken: "fresh", refreshToken: "rt2" });
    // refresh call hit the refresh endpoint with the stored refresh token
    const [refreshUrl, refreshInit] = fetchMock.mock.calls[1]!;
    expect(String(refreshUrl)).toContain("/auth/refresh");
    expect(JSON.parse((refreshInit as RequestInit).body as string)).toEqual({ refreshToken: "rt" });
    // retry used the fresh access token
    const [, retryInit] = fetchMock.mock.calls[2]!;
    expect((retryInit as RequestInit).headers).toMatchObject({ authorization: "Bearer fresh" });
  });

  it("clears the session and throws when refresh fails", async () => {
    const store = makeStore({ accessToken: "stale", refreshToken: "rt" });
    const fetchMock = vi
      .fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse({ message: "expired" }, 401))
      .mockResolvedValueOnce(jsonResponse({ message: "bad refresh" }, 401));
    const client = createApiClient(store, fetchMock as unknown as typeof fetch);

    await expect(client.get("/pages/x")).rejects.toBeInstanceOf(ApiError);
    expect(store.getTokens()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
