import { Injectable } from "@nestjs/common";

/**
 * The kinds of mutations the realtime layer (T4) broadcasts to a
 * `database:{id}` room. T3 emits these on every cell/row/property/view change;
 * the default implementation is a no-op so the API works without the gateway,
 * and T4 replaces the binding with the socket.io gateway.
 */
export type DatabaseEventType =
  | "cell.updated"
  | "row.created"
  | "row.deleted"
  | "property.created"
  | "property.updated"
  | "property.deleted"
  | "property.reordered"
  | "view.created"
  | "view.updated"
  | "view.deleted"
  | "database.updated"
  | "relation.linked"
  | "relation.unlinked";

export interface DatabaseEvent {
  /** The owning database id (the container page id) → the room name. */
  databaseId: string;
  type: DatabaseEventType;
  /** Free-form payload (rowPageId, propertyId, value, …). LWW per cell. */
  payload: Record<string, unknown>;
  /** The user who caused the change (so clients can ignore their own echo). */
  actorId?: string;
}

/**
 * Injection token for the realtime emitter. T3 depends on this abstraction so
 * T4 can drop in the WebSocket gateway without touching the services.
 */
export abstract class DatabaseEventsService {
  abstract emit(event: DatabaseEvent): void;
}

/**
 * Default no-op emitter. Wired in {@link DatabasesModule} until T4 provides the
 * real socket.io gateway. Keeping mutations call `emit` now means T4 only has to
 * implement the transport.
 */
@Injectable()
export class NoopDatabaseEventsService extends DatabaseEventsService {
  emit(_event: DatabaseEvent): void {
    // intentionally empty — replaced by the realtime gateway in T4
  }
}
