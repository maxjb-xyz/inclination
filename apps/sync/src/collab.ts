import jwt from "jsonwebtoken";
import { resolvePageAccess, type PageAccessPrisma } from "@inclination/db";

/**
 * Pure, dependency-injected collaboration logic for the sync server.
 *
 * Hocuspocus hooks are thin wrappers around these functions (see server.ts);
 * keeping the auth + persistence logic here — with prisma and the JWT secret
 * passed in — means it can be unit-tested without booting a websocket server.
 */

/** Yjs document names are `page:{pageId}`. */
const DOC_NAME_PREFIX = "page:";

/** Default access-token secret; mirrors apps/api AppConfig for local/test boots. */
export const DEFAULT_JWT_ACCESS_SECRET = "dev_access_secret_change_me";

/** Read the JWT access secret from the environment (no secrets hardcoded for prod). */
export function jwtAccessSecret(): string {
  return process.env.JWT_ACCESS_SECRET ?? DEFAULT_JWT_ACCESS_SECRET;
}

const WEAK_SECRETS = new Set(["", DEFAULT_JWT_ACCESS_SECRET, "change-me"]);

/**
 * Fail fast in production if the sync server's JWT secret is empty/weak. The
 * sync server MUST share the API's secret to verify access tokens; a silent
 * dev-default fallback previously made every collab connection reject with
 * "invalid signature". Guarding here surfaces the misconfiguration loudly and
 * mirrors the API's own guard (spec §9: same authz, secrets via env).
 */
export function assertSyncSecretsAreSafe(): void {
  if (process.env.NODE_ENV === "production" && WEAK_SECRETS.has(jwtAccessSecret())) {
    throw new Error(
      "JWT_ACCESS_SECRET must be set to a strong, unique value in production " +
        "(it must match the API's secret so the sync server can verify access tokens).",
    );
  }
}

/**
 * Parse the page id out of a Hocuspocus document name. Returns null for any
 * value that is not exactly `page:{nonEmptyId}` so malformed names are rejected
 * rather than silently treated as a page.
 */
export function documentNameToPageId(documentName: string): string | null {
  if (!documentName.startsWith(DOC_NAME_PREFIX)) return null;
  const id = documentName.slice(DOC_NAME_PREFIX.length);
  return id.length > 0 ? id : null;
}

/** Build the document name for a page id (kept here so the convention has one home). */
export function pageIdToDocumentName(pageId: string): string {
  return `${DOC_NAME_PREFIX}${pageId}`;
}

export interface AuthResult {
  /** Hocuspocus context carried for the lifetime of the connection. */
  context: { userId: string };
  /** When true, the connection may read but not write (no edit permission). */
  readOnly: boolean;
}

export interface AuthenticateDeps {
  prisma: PageAccessPrisma;
  secret: string;
}

/**
 * Authenticate and authorize a collaboration connection.
 *
 * - Verifies the JWT with the access secret and extracts `sub` as the user id.
 * - Parses the page id from the document name (`page:{id}`).
 * - Resolves access via the SHARED resolver (same as the API).
 *
 * Throws on any failure (bad/expired token, malformed document name, no access)
 * — Hocuspocus rejects the connection when onAuthenticate throws. On success
 * returns the context plus whether the connection should be read-only.
 */
export async function authenticatePage(
  deps: AuthenticateDeps,
  token: string,
  documentName: string,
): Promise<AuthResult> {
  if (!token) throw new Error("Missing authentication token");

  const pageId = documentNameToPageId(documentName);
  if (!pageId) throw new Error(`Invalid document name: ${documentName}`);

  let payload: jwt.JwtPayload;
  try {
    const decoded = jwt.verify(token, deps.secret);
    if (typeof decoded === "string") throw new Error("Unexpected token payload");
    payload = decoded;
  } catch (err) {
    throw new Error(`Invalid token: ${(err as Error).message}`);
  }

  const userId = typeof payload.sub === "string" ? payload.sub : "";
  if (!userId) throw new Error("Token missing subject");

  const access = await resolvePageAccess(deps.prisma, userId, pageId);
  if (!access || !access.canRead) {
    throw new Error("Access denied");
  }

  return { context: { userId }, readOnly: !access.canWrite };
}

/**
 * Minimal Prisma surface the persistence functions need. Structural typing keeps
 * these unit-testable with a fake, while the real PrismaClient satisfies it.
 */
/** Prisma's `Bytes` column maps to an `ArrayBuffer`-backed Uint8Array. */
type Bytes = Uint8Array<ArrayBuffer>;

export interface CollabPrisma {
  pageContent: {
    findUnique(args: {
      where: { pageId: string };
      select: { ydocState: true };
    }): Promise<{ ydocState: Bytes | null } | null>;
    upsert(args: {
      where: { pageId: string };
      create: { pageId: string; ydocState: Bytes };
      update: { ydocState: Bytes };
    }): Promise<unknown>;
  };
  pageSnapshot: {
    create(args: {
      data: { pageId: string; ydocSnapshot: Bytes; authorId?: string | null };
    }): Promise<unknown>;
  };
}

/**
 * Normalize a (possibly Buffer / SharedArrayBuffer-backed) byte source into a
 * plain `ArrayBuffer`-backed `Uint8Array`, which is what Prisma's `Bytes` column
 * type expects. Copies, so the stored bytes are decoupled from the source.
 */
function toBytes(state: Uint8Array): Bytes {
  const out = new Uint8Array(state.length);
  out.set(state);
  return out as Bytes;
}

/**
 * Load a page's persisted Yjs state. Returns null when the page has no stored
 * state yet (fresh collaborative document).
 */
export async function fetchYdocState(
  prisma: CollabPrisma,
  documentName: string,
): Promise<Uint8Array | null> {
  const pageId = documentNameToPageId(documentName);
  if (!pageId) return null;

  const row = await prisma.pageContent.findUnique({
    where: { pageId },
    select: { ydocState: true },
  });
  if (!row?.ydocState) return null;
  return row.ydocState instanceof Uint8Array ? row.ydocState : new Uint8Array(row.ydocState);
}

/**
 * Persist a page's Yjs state, creating the PageContent row if it does not exist.
 * Throws for a malformed document name so a bad name never silently no-ops.
 */
export async function storeYdocState(
  prisma: CollabPrisma,
  documentName: string,
  state: Uint8Array,
): Promise<void> {
  const pageId = documentNameToPageId(documentName);
  if (!pageId) throw new Error(`Invalid document name: ${documentName}`);

  const bytes = toBytes(state);
  await prisma.pageContent.upsert({
    where: { pageId },
    create: { pageId, ydocState: bytes },
    update: { ydocState: bytes },
  });
}

/** Default minimum spacing between snapshot rows for a single page (~2 minutes). */
export const SNAPSHOT_MIN_INTERVAL_MS = 2 * 60 * 1000;

/**
 * Throttled snapshot writer. Records a PageSnapshot row at most once per
 * `minIntervalMs` per page, using an injected in-memory last-write map (so the
 * caller owns the map's lifetime and tests can control `now`). Returns whether a
 * snapshot was written. Failures here must never break the primary store, so the
 * caller is expected to ignore/log rejections.
 */
export async function maybeWriteSnapshot(
  prisma: CollabPrisma,
  documentName: string,
  state: Uint8Array,
  lastWrites: Map<string, number>,
  options: { now?: number; minIntervalMs?: number; authorId?: string | null } = {},
): Promise<boolean> {
  const pageId = documentNameToPageId(documentName);
  if (!pageId) return false;

  const now = options.now ?? Date.now();
  const minInterval = options.minIntervalMs ?? SNAPSHOT_MIN_INTERVAL_MS;
  const last = lastWrites.get(pageId);
  if (last !== undefined && now - last < minInterval) return false;

  lastWrites.set(pageId, now);
  await prisma.pageSnapshot.create({
    data: { pageId, ydocSnapshot: toBytes(state), authorId: options.authorId ?? null },
  });
  return true;
}
