import { describe, expect, it, vi } from "vitest";
import { createDbApi } from "../src/databases/dbApi";
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
    request: vi.fn((path: string, opts: { method?: string; body?: unknown }) => {
      calls.push({ method: opts.method ?? "GET", path, body: opts.body });
      return Promise.resolve({});
    }),
  } as unknown as ApiClient;
  return { client, calls };
}

describe("dbApi", () => {
  it("createDatabase POSTs to the workspace databases endpoint", async () => {
    const { client, calls } = stubClient();
    await createDbApi(client).createDatabase("ws1", { title: "Tasks" });
    expect(calls[0]).toEqual({
      method: "POST",
      path: "/workspaces/ws1/databases",
      body: { title: "Tasks" },
    });
  });

  it("getDatabase / updateDatabase target /databases/:id", async () => {
    const { client, calls } = stubClient();
    const api = createDbApi(client);
    await api.getDatabase("db1");
    await api.updateDatabase("db1", { subitemsEnabled: true });
    expect(calls[0]).toMatchObject({ method: "GET", path: "/databases/db1" });
    expect(calls[1]).toMatchObject({
      method: "PATCH",
      path: "/databases/db1",
      body: { subitemsEnabled: true },
    });
  });

  it("property endpoints map to the right routes/methods", async () => {
    const { client, calls } = stubClient();
    const api = createDbApi(client);
    await api.createProperty("db1", { name: "Status", type: "status", config: { options: [], groups: [] } });
    await api.updateProperty("p1", { name: "S" });
    await api.reorderProperties("db1", { propertyIds: ["p1", "p2"] });
    await api.deleteProperty("p1");
    expect(calls[0]).toMatchObject({ method: "POST", path: "/databases/db1/properties" });
    expect(calls[1]).toMatchObject({ method: "PATCH", path: "/properties/p1" });
    expect(calls[2]).toMatchObject({ method: "POST", path: "/databases/db1/properties/reorder" });
    expect(calls[3]).toMatchObject({ method: "DELETE", path: "/properties/p1" });
  });

  it("view endpoints map to the right routes/methods", async () => {
    const { client, calls } = stubClient();
    const api = createDbApi(client);
    await api.createView("db1", { type: "board", name: "Board" });
    await api.updateView("v1", { name: "B" });
    await api.deleteView("v1");
    await api.setDefaultView("v1");
    expect(calls[0]).toMatchObject({ method: "POST", path: "/databases/db1/views" });
    expect(calls[1]).toMatchObject({ method: "PATCH", path: "/views/v1" });
    expect(calls[2]).toMatchObject({ method: "DELETE", path: "/views/v1" });
    expect(calls[3]).toMatchObject({ method: "POST", path: "/views/v1/default" });
  });

  it("setCell PUTs the value to /rows/:rowId/cells/:propertyId", async () => {
    const { client, calls } = stubClient();
    await createDbApi(client).setCell("row1", "prop1", "done");
    expect(calls[0]).toEqual({
      method: "PUT",
      path: "/rows/row1/cells/prop1",
      body: { value: "done" },
    });
  });

  it("query POSTs to /databases/:id/query", async () => {
    const { client, calls } = stubClient();
    await createDbApi(client).query("db1", { viewId: "v1" });
    expect(calls[0]).toEqual({
      method: "POST",
      path: "/databases/db1/query",
      body: { viewId: "v1" },
    });
  });

  it("relation link POSTs and unlink DELETEs with a body", async () => {
    const { client, calls } = stubClient();
    const api = createDbApi(client);
    const link = { propertyId: "p1", fromRowId: "r1", toRowId: "r2" };
    await api.linkRelation("p1", link);
    await api.unlinkRelation("p1", link);
    expect(calls[0]).toEqual({ method: "POST", path: "/properties/p1/links", body: link });
    expect(calls[1]).toEqual({ method: "DELETE", path: "/properties/p1/links", body: link });
  });
});
