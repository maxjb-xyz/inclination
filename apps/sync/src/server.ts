import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { Server as Hocuspocus } from "@hocuspocus/server";
import { getPrisma } from "@inclination/db";
import { WebSocketServer } from "ws";
import { liveness, readiness } from "./health.js";

export interface SyncServer {
  http: HttpServer;
  listen: (port: number) => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Build the sync server: a plain HTTP server answering /health and /ready, plus
 * a Hocuspocus Yjs websocket endpoint mounted at /collab. Real per-page auth and
 * Yjs persistence are added in Phase 3; for now the websocket endpoint simply
 * accepts connections so the process is wired end to end.
 */
export function createSyncServer(): SyncServer {
  const prisma = getPrisma();
  const hocuspocus = Hocuspocus.configure({});

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
