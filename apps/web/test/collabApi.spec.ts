import { describe, expect, it, vi } from "vitest";
import { createCollabApi } from "../src/api/collabApi";
import type { ApiClient } from "../src/api/apiClient";

/** A stub ApiClient recording method + path + body for each call. */
function stubClient() {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const record =
    (method: string) =>
    (path: string, body?: unknown) => {
      calls.push({ method, path, body });
      return Promise.resolve({});
    };
  const client = {
    get: vi.fn(record("GET")),
    post: vi.fn(record("POST")),
    patch: vi.fn(record("PATCH")),
    put: vi.fn(record("PUT")),
    del: vi.fn(record("DELETE")),
    request: vi.fn(),
  } as unknown as ApiClient;
  return { client, calls };
}

describe("collabApi", () => {
  it("maps access + sharing endpoints", async () => {
    const { client, calls } = stubClient();
    const api = createCollabApi(client);
    await api.getAccess("p1");
    await api.listPermissions("p1");
    await api.upsertPermission("p1", { subjectType: "user", subjectId: "u1", role: "read" });
    await api.removePermission("p1", "perm1");
    await api.shareInvite("p1", { email: "a@b.com", role: "comment" });
    expect(calls[0]).toMatchObject({ method: "GET", path: "/pages/p1/access" });
    expect(calls[1]).toMatchObject({ method: "GET", path: "/pages/p1/permissions" });
    expect(calls[2]).toMatchObject({
      method: "PUT",
      path: "/pages/p1/permissions",
      body: { subjectType: "user", subjectId: "u1", role: "read" },
    });
    expect(calls[3]).toMatchObject({ method: "DELETE", path: "/pages/p1/permissions/perm1" });
    expect(calls[4]).toMatchObject({
      method: "POST",
      path: "/pages/p1/share-invite",
      body: { email: "a@b.com", role: "comment" },
    });
  });

  it("maps comment endpoints", async () => {
    const { client, calls } = stubClient();
    const api = createCollabApi(client);
    await api.listComments("p1");
    await api.createComment("p1", { body: { type: "doc" } });
    await api.resolveThread("c1");
    await api.unresolveThread("c1");
    await api.deleteComment("c1");
    expect(calls[0]).toMatchObject({ method: "GET", path: "/pages/p1/comments" });
    expect(calls[1]).toMatchObject({ method: "POST", path: "/pages/p1/comments" });
    expect(calls[2]).toMatchObject({ method: "POST", path: "/comments/c1/resolve" });
    expect(calls[3]).toMatchObject({ method: "POST", path: "/comments/c1/unresolve" });
    expect(calls[4]).toMatchObject({ method: "DELETE", path: "/comments/c1" });
  });

  it("maps notification endpoints", async () => {
    const { client, calls } = stubClient();
    const api = createCollabApi(client);
    await api.listNotifications();
    await api.unreadCount();
    await api.markRead("n1");
    await api.markAllRead();
    expect(calls[0]).toMatchObject({ method: "GET", path: "/notifications" });
    expect(calls[1]).toMatchObject({ method: "GET", path: "/notifications/unread-count" });
    expect(calls[2]).toMatchObject({ method: "POST", path: "/notifications/n1/read" });
    expect(calls[3]).toMatchObject({ method: "POST", path: "/notifications/read-all" });
  });
});
