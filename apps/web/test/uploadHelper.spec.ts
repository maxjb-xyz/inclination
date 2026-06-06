import { describe, expect, it, vi } from "vitest";
import { createUploadApi, UploadError } from "../src/api/uploadHelper";
import type { ApiClient } from "../src/api/apiClient";

/** A stub ApiClient recording calls and returning queued responses. */
function stubClient(responses: Record<string, unknown>) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const make =
    (method: string) =>
    (path: string, body?: unknown) => {
      calls.push({ method, path, body });
      return Promise.resolve(responses[`${method} ${path}`] ?? {});
    };
  const client = {
    get: vi.fn((p: string) => make("GET")(p)),
    post: vi.fn(make("POST")),
    patch: vi.fn(make("PATCH")),
    put: vi.fn(make("PUT")),
    del: vi.fn((p: string) => make("DELETE")(p)),
    request: vi.fn(),
  } as unknown as ApiClient;
  return { client, calls };
}

/** A minimal File-like object whose bytes are deterministic. */
function fakeFile(name: string, type: string, bytes: number[]): File {
  return {
    name,
    type,
    size: bytes.length,
    arrayBuffer: () => Promise.resolve(new Uint8Array(bytes).buffer),
  } as unknown as File;
}

describe("uploadHelper — presign → PUT → resolve", () => {
  it("presigns, PUTs the bytes with the right content-type, and returns the attachment ref", async () => {
    const { client, calls } = stubClient({
      "POST /workspaces/ws1/uploads/presign": {
        uploadUrl: "https://minio.local/bucket/key?sig=abc",
        objectKey: "ws1/uuid/pic.png",
        attachmentId: "att1",
        downloadPath: "/api/attachments/att1",
      },
    });
    const rawFetch = vi.fn(async () => new Response(null, { status: 200 }));
    const api = createUploadApi(client, rawFetch as unknown as typeof fetch);

    const file = fakeFile("pic.png", "image/png", [1, 2, 3]);
    const ref = await api.uploadFile("ws1", file, { pageId: "p1" });

    // Presign body carries filename/mime/size/pageId.
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/workspaces/ws1/uploads/presign",
      body: { filename: "pic.png", mime: "image/png", size: 3, pageId: "p1" },
    });

    // PUT goes to the presigned URL with the same content-type.
    expect(rawFetch).toHaveBeenCalledTimes(1);
    const [url, init] = rawFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://minio.local/bucket/key?sig=abc");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("image/png");

    expect(ref).toEqual({
      attachmentId: "att1",
      objectKey: "ws1/uuid/pic.png",
      downloadPath: "/api/attachments/att1",
    });
  });

  it("throws UploadError when the PUT fails", async () => {
    const { client } = stubClient({
      "POST /workspaces/ws1/uploads/presign": {
        uploadUrl: "https://minio.local/key",
        objectKey: "k",
        attachmentId: "att2",
        downloadPath: "/api/attachments/att2",
      },
    });
    const rawFetch = vi.fn(async () => new Response("nope", { status: 403 }));
    const api = createUploadApi(client, rawFetch as unknown as typeof fetch);

    await expect(api.uploadFile("ws1", fakeFile("f.bin", "application/octet-stream", [9]))).rejects.toBeInstanceOf(
      UploadError,
    );
  });

  it("resolveUrl re-fetches a fresh presigned GET URL for an attachment id", async () => {
    const { client, calls } = stubClient({
      "GET /attachments/att1": { url: "https://minio.local/bucket/key?fresh=1" },
    });
    const api = createUploadApi(client, vi.fn() as unknown as typeof fetch);

    const url = await api.resolveUrl("att1");
    expect(url).toBe("https://minio.local/bucket/key?fresh=1");
    expect(calls[0]).toMatchObject({ method: "GET", path: "/attachments/att1" });
  });
});
