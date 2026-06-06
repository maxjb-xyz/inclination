import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { Server as Hocuspocus } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import { getPrisma } from "@inclination/db";
import { WebSocketServer } from "ws";
import { liveness, readiness } from "./health.js";
import {
  authenticateDocument,
  fetchDocumentState,
  indexPageBody,
  isSyncedDocument,
  jwtAccessSecret,
  maybeWriteSnapshot,
  storeDocumentState,
} from "./collab.js";

export interface SyncServer {
  http: HttpServer;
  listen: (port: number) => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Build the sync server: a plain HTTP server answering /health and /ready, plus
 * a Hocuspocus Yjs websocket endpoint mounted at /collab.
 *
 * Authorization is enforced per page via the SAME shared resolver the API uses
 * (spec §9): the JWT identifies the user, the document name (`page:{id}`)
 * identifies the page, and `resolvePageAccess` decides read/write. Persistence
 * is handled by the Database extension, which debounces stores; we additionally
 * write throttled PageSnapshot rows for future version history.
 */
export function createSyncServer(): SyncServer {
  const prisma = getPrisma();
  const secret = jwtAccessSecret();
  // Per-page timestamp of the last snapshot, used to throttle snapshot writes.
  const lastSnapshotAt = new Map<string, number>();

  const hocuspocus = Hocuspocus.configure({
    async onAuthenticate({ token, documentName, connection }) {
      // Routes on the document-name prefix: `page:{id}` → per-page authz,
      // `synced:{id}` → synced-block workspace-membership authz (spec §6/§9).
      const result = await authenticateDocument({ prisma, secret }, token, documentName);
      // Read-only connections may sync but cannot push updates (no edit access).
      if (result.readOnly) {
        connection.readOnly = true;
      }
      return result.context;
    },
    extensions: [
      new Database({
        fetch: ({ documentName }) => fetchDocumentState(prisma, documentName),
        store: async ({ documentName, state, context }) => {
          await storeDocumentState(prisma, documentName, state);
          // Synced blocks are their own docs (no page snapshot / search index).
          if (isSyncedDocument(documentName)) return;
          // Snapshot groundwork: best-effort, throttled, never breaks the store.
          try {
            const authorId =
              context && typeof (context as { userId?: unknown }).userId === "string"
                ? (context as { userId: string }).userId
                : null;
            await maybeWriteSnapshot(prisma, documentName, state, lastSnapshotAt, { authorId });
          } catch (err) {
            console.error(
              JSON.stringify({ level: "warn", msg: "snapshot write failed", error: String(err) }),
            );
          }
          // Search index maintenance (spec §6): extract plain text and upsert the
          // page's SearchIndex. Best-effort — failure must never break the store.
          try {
            await indexPageBody(prisma, documentName, state);
          } catch (err) {
            console.error(
              JSON.stringify({ level: "warn", msg: "search index update failed", error: String(err) }),
            );
          }
        },
      }),
    ],
  });

  const http = createServer((req, res) => {
    void handleHttp(req, res);
  });

  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (websocket, request) => {
    hocuspocus.handleConnection(websocket, request);
  });

  http.on("upgrade", (request, socket, head) => {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    if (pathname === "/collab" || pathname.startsWith("/collab/")) {
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
    } else {
      socket.destroy();
    }
  });

  async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? "/";
    let result;
    if (url === "/health") {
      result = liveness();
    } else if (url === "/ready") {
      result = await readiness(() => prisma.$queryRaw`SELECT 1`);
    } else {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "not_found" }));
      return;
    }
    res.writeHead(result.statusCode, { "content-type": "application/json" });
    res.end(JSON.stringify(result.body));
  }

  return {
    http,
    listen: (port: number) =>
      new Promise<void>((resolve) => {
        http.listen(port, "0.0.0.0", () => resolve());
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        wss.close();
        void hocuspocus.destroy();
        http.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
