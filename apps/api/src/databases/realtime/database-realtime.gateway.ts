import { Logger } from "@nestjs/common";
import {
  type OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { AppConfig } from "../../config/app-config";
import { DatabaseAccessService } from "../database-access.service";
import { DatabaseEventsService, type DatabaseEvent } from "../database-events.service";
import {
  authorizeSubscribe,
  databaseRoom,
  tokenFromHandshake,
  userIdFromToken,
} from "./realtime-auth";

/** Per-connection state stored on the socket once it is authenticated. */
interface SocketState {
  userId: string;
}

/**
 * Realtime broadcast gateway for databases (spec §3/§6, plan T4).
 *
 * - Transport: socket.io mounted at `path: /api/realtime` so the existing Caddy
 *   `/api/*` reverse_proxy (which forwards Upgrade headers) routes the websocket
 *   to the API with no extra Caddy rule. `/collab` (Hocuspocus) is untouched.
 * - Auth on connect: the handshake access token (`auth.token` ?? `query.token`)
 *   is verified with the SAME jwtAccessSecret as the rest of the API; an invalid
 *   token disconnects the socket. The user id is stored on the socket.
 * - Rooms + authz: a client emits `subscribe { databaseId }`; access is checked
 *   through the shared DatabaseAccessService.requireDatabase before joining the
 *   `database:{id}` room. `unsubscribe` leaves the room.
 * - Broadcast: this gateway IS the DatabaseEventsService — every cell/row/
 *   property/view/relation mutation from T3 calls `emit(event)`, which fans the
 *   event out to `database:{event.databaseId}` as a `database:event` message.
 *
 * The auth/subscribe/room logic is factored into ./realtime-auth.ts and unit
 * tested without a live server.
 */
@WebSocketGateway({
  path: "/api/realtime",
  // Same-origin through Caddy needs no CORS; a separate dev frontend origin does.
  // Mirror the HTTP CORS origin; credentials stay off (bearer-token, not cookie).
  cors: { origin: true, credentials: false },
})
export class DatabaseRealtimeGateway
  extends DatabaseEventsService
  implements OnGatewayConnection
{
  private readonly logger = new Logger(DatabaseRealtimeGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly config: AppConfig,
    private readonly access: DatabaseAccessService,
  ) {
    super();
  }

  /**
   * Authenticate the handshake. On a valid access token, store the user id on
   * the socket; otherwise disconnect immediately (the client never joins a room
   * and receives no events).
   */
  handleConnection(client: Socket): void {
    try {
      const token = tokenFromHandshake(client.handshake);
      const userId = userIdFromToken(token, this.config.jwtAccessSecret);
      (client.data as SocketState).userId = userId;
    } catch (err) {
      this.logger.debug(`realtime auth rejected: ${(err as Error).message}`);
      client.emit("error", { message: "unauthorized" });
      client.disconnect(true);
    }
  }

  /**
   * Join a `database:{id}` room after verifying the connected user can access the
   * database via the shared resolver. Returns an ack so the client knows whether
   * the subscription succeeded. Rejects (no join) for an unauthenticated socket,
   * a missing/invalid id, or a database the user cannot access.
   */
  @SubscribeMessage("subscribe")
  async onSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { databaseId?: unknown } | undefined,
  ): Promise<{ ok: boolean; databaseId?: string; error?: string }> {
    const userId = (client.data as SocketState).userId;
    if (!userId) return { ok: false, error: "unauthorized" };

    const room = await authorizeSubscribe(userId, body?.databaseId, (uid, dbId) =>
      this.canAccessDatabase(uid, dbId),
    );
    if (!room) return { ok: false, error: "forbidden" };

    await client.join(room);
    return { ok: true, databaseId: body?.databaseId as string };
  }

  /** Leave a `database:{id}` room. Idempotent; safe for an unknown room. */
  @SubscribeMessage("unsubscribe")
  async onUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { databaseId?: unknown } | undefined,
  ): Promise<{ ok: boolean }> {
    const databaseId = body?.databaseId;
    if (typeof databaseId === "string" && databaseId.length > 0) {
      await client.leave(databaseRoom(databaseId));
    }
    return { ok: true };
  }

  /**
   * DatabaseEventsService implementation: fan a T3 mutation event out to the
   * subscribers of its database room. The payloads are already shaped by T3 (no
   * secrets); we just route them to `database:{databaseId}` as `database:event`.
   * Defensive against being called before the server is bound.
   */
  emit(event: DatabaseEvent): void {
    if (!this.server) return;
    this.server.to(databaseRoom(event.databaseId)).emit("database:event", event);
  }

  /**
   * Adapt the throwing DatabaseAccessService.requireDatabase to a boolean for
   * authorizeSubscribe: the user can access the database iff the shared resolver
   * does not throw (Forbidden/NotFound → false). No authz logic is duplicated.
   */
  private async canAccessDatabase(userId: string, databaseId: string): Promise<boolean> {
    try {
      await this.access.requireDatabase(userId, databaseId);
      return true;
    } catch {
      return false;
    }
  }
}
