import { useAuthStore } from "../auth/authStore";
import type { Tokens } from "../auth/authClient";
import type { PublicUser } from "../auth/types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

/**
 * Minimal interface onto the auth store so the client can be unit-tested
 * without React. Mirrors the persisted zustand store.
 */
export interface SessionStore {
  getTokens: () => Tokens | null;
  getUser: () => PublicUser | null;
  setSession: (user: PublicUser, tokens: Tokens) => void;
  clear: () => void;
}

/** Default store binding backed by the real zustand auth store. */
export const zustandSessionStore: SessionStore = {
  getTokens: () => useAuthStore.getState().tokens,
  getUser: () => useAuthStore.getState().user,
  setSession: (user, tokens) => useAuthStore.getState().setSession(user, tokens),
  clear: () => useAuthStore.getState().clear(),
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
}

async function parseError(res: Response): Promise<string> {
  const detail = (await res.json().catch(() => ({}))) as { message?: string };
  return detail.message ?? `Request failed (${res.status})`;
}

/**
 * Creates an authenticated fetch client. Attaches the Bearer access token
 * from the session store, and on 401 attempts a single token refresh + retry.
 * If refresh fails, the session is cleared and the original error surfaces.
 */
export function createApiClient(
  store: SessionStore,
  // Resolve `globalThis.fetch` lazily at call time rather than binding it once
  // at construction. Binding eagerly captured whatever `fetch` existed when the
  // singleton was imported, which made it impossible for tests to swap in a
  // mock via `vi.stubGlobal("fetch", …)` after import.
  fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args),
) {
  // Single-flight guard: when several requests 401 concurrently (parallel
  // queries against an expired access token), they must share ONE /auth/refresh
  // call. The server rotates refresh tokens with reuse/theft detection, so a
  // second concurrent refresh would present an already-rotated token and get the
  // whole session revoked. While a refresh is in flight, all callers await it.
  let refreshInFlight: Promise<string | null> | null = null;

  async function doRefresh(): Promise<string | null> {
    const tokens = store.getTokens();
    const user = store.getUser();
    if (!tokens || !user) return null;
    const res = await fetchImpl(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    if (!res.ok) {
      store.clear();
      return null;
    }
    const data = (await res.json()) as { tokens: Tokens };
    store.setSession(user, data.tokens);
    return data.tokens.accessToken;
  }

  /**
   * Refreshes tokens via /auth/refresh; returns the new access token or null.
   * Deduped so concurrent 401s trigger only a single rotation per expiry.
   */
  function refresh(): Promise<string | null> {
    if (!refreshInFlight) {
      refreshInFlight = doRefresh().finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  }

  async function send(path: string, options: RequestOptions, accessToken: string | null) {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    return fetchImpl(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const tokens = store.getTokens();
    let res = await send(path, options, tokens?.accessToken ?? null);

    if (res.status === 401) {
      const newToken = await refresh();
      if (newToken === null) {
        throw new ApiError(401, await parseError(res));
      }
      res = await send(path, options, newToken);
    }

    if (!res.ok) {
      throw new ApiError(res.status, await parseError(res));
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    request,
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
    patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
    put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
    del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Singleton client wired to the real zustand store + global fetch. */
export const apiClient = createApiClient(zustandSessionStore);
