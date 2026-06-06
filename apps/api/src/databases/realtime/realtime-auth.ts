import jwt from "jsonwebtoken";

/**
 * Pure, transport-agnostic logic for the realtime gateway (T4).
 *
 * Keeping the handshake-token verification, room-name convention and
 * subscribe-authorization here — with the JWT secret and an access checker
 * passed in — means the socket.io gateway is a thin wrapper around functions
 * that can be unit-tested without booting a websocket server (mirrors how the
 * sync server factors its collab logic into apps/sync/src/collab.ts).
 */

/** Room name for a database channel. Clients of `database:{id}` get its events. */
export function databaseRoom(databaseId: string): string {
  return `database:${databaseId}`;
}

/**
 * Verify a websocket handshake access token and extract the user id.
 *
 * Uses the SAME access secret as the API (AppConfig.jwtAccessSecret) so a token
 * minted by the auth endpoints is accepted here unchanged — no duplicated secret
 * handling. Returns the user id (`sub`) on success or throws on any failure
 * (missing/empty/expired/bad-signature/subject-less token). The caller maps a
 * throw to a connection rejection.
 */
export function userIdFromToken(token: string | undefined, secret: string): string {
  if (!token) throw new Error("Missing authentication token");

  let payload: jwt.JwtPayload;
  try {
    const decoded = jwt.verify(token, secret);
    if (typeof decoded === "string") throw new Error("Unexpected token payload");
    payload = decoded;
  } catch (err) {
    throw new Error(`Invalid token: ${(err as Error).message}`);
  }

  const userId = typeof payload.sub === "string" ? payload.sub : "";
  if (!userId) throw new Error("Token missing subject");
  return userId;
}

/**
 * The handshake shape socket.io exposes. The token may arrive either in the
 * connection `auth` payload (preferred — socket.io-client `auth: { token }`) or
 * as a `token` query param (fallback for clients that can only set the URL).
 */
export interface HandshakeLike {
  auth?: { token?: unknown };
  query?: { token?: unknown };
}

/** Read the access token out of a socket.io handshake (`auth.token` ?? `query.token`). */
export function tokenFromHandshake(handshake: HandshakeLike | undefined): string | undefined {
  const fromAuth = handshake?.auth?.token;
  if (typeof fromAuth === "string" && fromAuth.length > 0) return fromAuth;
  const fromQuery = handshake?.query?.token;
  if (typeof fromQuery === "string" && fromQuery.length > 0) return fromQuery;
  return undefined;
}

/**
 * A minimal access checker: resolves to `true` when `userId` may access
 * `databaseId`, `false` otherwise. The gateway adapts DatabaseAccessService to
 * this (requireDatabase throws Forbidden/NotFound → false), so the authz lives
 * in the shared resolver, never duplicated here.
 */
export type DatabaseAccessChecker = (userId: string, databaseId: string) => Promise<boolean>;

/**
 * Decide whether a subscribe request is allowed and, if so, the room to join.
 * Validates the requested databaseId and delegates the access decision to the
 * injected checker. Returns the room name when authorized, or null when the
 * id is invalid or the user cannot access the database (the caller does not join
 * and signals an error to the client).
 */
export async function authorizeSubscribe(
  userId: string,
  databaseId: unknown,
  canAccess: DatabaseAccessChecker,
): Promise<string | null> {
  if (typeof databaseId !== "string" || databaseId.length === 0) return null;
  const ok = await canAccess(userId, databaseId);
  return ok ? databaseRoom(databaseId) : null;
}
