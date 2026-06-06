import jwt from "jsonwebtoken";
import { resolvePageAccess, type PageAccessPrisma } from "@inclination/db";
import { extractPlainTextFromUpdate } from "./extract.js";

/**
 * Pure, dependency-injected collaboration logic for the sync server.
 *
 * Hocuspocus hooks are thin wrappers around these functions (see server.ts);
 * keeping the auth + persistence logic here — with prisma and the JWT secret
 * passed in — means it can be unit-tested without booting a websocket server.
 */

/** Yjs document names are `page:{pageId}`. */
const DOC_NAME_PREFIX = "page:";

/** Synced-block Yjs document names are `synced:{syncedBlockId}` (spec §6). */
const SYNCED_DOC_NAME_PREFIX = "synced:";

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

/**
 * Parse the synced-block id out of a document name. Returns null for anything
 * that is not exactly `synced:{nonEmptyId}` so malformed names are rejected.
 */
export function documentNameToSyncedId(documentName: string): string | null {
  if (!documentName.startsWith(SYNCED_DOC_NAME_PREFIX)) return null;
  const id = documentName.slice(SYNCED_DOC_NAME_PREFIX.length);
  return id.length > 0 ? id : null;
}

/** Build the document name for a synced-block id. */
export function syncedIdToDocumentName(syncedId: string): string {
  return `${SYNCED_DOC_NAME_PREFIX}${syncedId}`;
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
 * Minimal Prisma surface for synced-block authorization: look up the block's
 * workspace and the caller's membership. Structural typing keeps the auth logic
 * unit-testable with a fake while the real PrismaClient satisfies it.
 */
export interface SyncedAccessPrisma {
  syncedBlock: {
    findUnique(args: {
      where: { id: string };
      select: { workspaceId: true };
    }): Promise<{ workspaceId: string } | null>;
  };
  workspaceMember: {
    findUnique(args: {
      where: { workspaceId_userId: { workspaceId: string; userId: string } };
    }): Promise<Record<string, unknown> | null>;
  };
}

export interface SyncedAuthenticateDeps {
  prisma: SyncedAccessPrisma;
  secret: string;
}

/**
 * Authenticate + authorize a SYNCED-BLOCK connection (`synced:{id}`).
 *
 * - Verifies the JWT and extracts the user id.
 * - Parses the synced-block id from the document name.
 * - Loads the block (reject if missing) and requires the user be a member of the
 *   block's workspace (reject non-members) — matching the API's
 *   `SyncedBlocksService.get` so the two layers agree (spec §9).
 *
 * Synced blocks are collaboratively editable by any workspace member, so a
 * member connection is always writable (no read-only role split here).
 */
export async function authenticateSyncedBlock(
  deps: SyncedAuthenticateDeps,
  token: string,
  documentName: string,
): Promise<AuthResult> {
  if (!token) throw new Error("Missing authentication token");

  const syncedId = documentNameToSyncedId(documentName);
  if (!syncedId) throw new Error(`Invalid document name: ${documentName}`);

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

  const block = await deps.prisma.syncedBlock.findUnique({
    where: { id: syncedId },
    select: { workspaceId: true },
  });
  if (!block) throw new Error("Access denied");

  const member = await deps.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: block.workspaceId, userId } },
  });
  if (!member) throw new Error("Access denied");

  return { context: { userId }, readOnly: false };
}

/**
 * Route an incoming connection to the correct authenticator based on the
 * document-name prefix: `page:{id}` → page authz, `synced:{id}` → synced-block
 * authz. The page resolver and synced resolver share the PrismaClient, which
 * structurally satisfies both surfaces. Throws on an unrecognized name.
 */
export async function authenticateDocument(
  deps: { prisma: PageAccessPrisma & SyncedAccessPrisma; secret: string },
  token: string,
  documentName: string,
): Promise<AuthResult> {
  if (documentNameToSyncedId(documentName)) {
    return authenticateSyncedBlock(
      { prisma: deps.prisma, secret: deps.secret },
      token,
      documentName,
    );
  }
  return authenticatePage({ prisma: deps.prisma, secret: deps.secret }, token, documentName);
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
  page: {
    findUnique(args: {
      where: { id: string };
      select: { workspaceId: true; title: true };
    }): Promise<{ workspaceId: string; title: string } | null>;
  };
  syncedBlock: {
    findUnique(args: {
      where: { id: string };
      select: { ydocState: true };
    }): Promise<{ ydocState: Bytes | null } | null>;
    update(args: {
      where: { id: string };
      data: { ydocState: Bytes };
    }): Promise<unknown>;
  };
  searchIndex: {
    upsert(args: {
      where: { pageId: string };
      create: { pageId: string; workspaceId: string; title: string; bodyText: string };
      update: { workspaceId: string; title: string; bodyText: string };
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

/**
 * Load a synced block's persisted Yjs state. Returns null when the block has no
 * stored state yet (fresh synced document) or the name is malformed.
 */
export async function fetchSyncedState(
  prisma: CollabPrisma,
  documentName: string,
): Promise<Uint8Array | null> {
  const syncedId = documentNameToSyncedId(documentName);
  if (!syncedId) return null;

  const row = await prisma.syncedBlock.findUnique({
    where: { id: syncedId },
    select: { ydocState: true },
  });
  if (!row?.ydocState) return null;
  return row.ydocState instanceof Uint8Array ? row.ydocState : new Uint8Array(row.ydocState);
}

/**
 * Persist a synced block's Yjs state. The SyncedBlock row is created by the API
 * before any connection, so this `update`s the existing row. Throws on a
 * malformed name so a bad name never silently no-ops.
 */
export async function storeSyncedState(
  prisma: CollabPrisma,
  documentName: string,
  state: Uint8Array,
): Promise<void> {
  const syncedId = documentNameToSyncedId(documentName);
  if (!syncedId) throw new Error(`Invalid document name: ${documentName}`);
  await prisma.syncedBlock.update({
    where: { id: syncedId },
    data: { ydocState: toBytes(state) },
  });
}

/**
 * Dispatch a Database-extension fetch to the correct store based on the
 * document-name prefix (`synced:{id}` → SyncedBlock, else `page:{id}` →
 * PageContent). One entry point keeps the Hocuspocus wiring simple.
 */
export async function fetchDocumentState(
  prisma: CollabPrisma,
  documentName: string,
): Promise<Uint8Array | null> {
  if (documentNameToSyncedId(documentName)) {
    return fetchSyncedState(prisma, documentName);
  }
  return fetchYdocState(prisma, documentName);
}

/** Dispatch a Database-extension store to the correct persistence path. */
export async function storeDocumentState(
  prisma: CollabPrisma,
  documentName: string,
  state: Uint8Array,
): Promise<void> {
  if (documentNameToSyncedId(documentName)) {
    await storeSyncedState(prisma, documentName, state);
    return;
  }
  await storeYdocState(prisma, documentName, state);
}

/** True for a synced-block document name (so the server skips page-only side effects). */
export function isSyncedDocument(documentName: string): boolean {
  return documentNameToSyncedId(documentName) !== null;
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

/**
 * Maintain the page's full-text search index after a store (spec §6). Extracts
 * plain text from the just-persisted Yjs state and upserts the page's
 * SearchIndex row with the extracted body + the page's current title +
 * workspace. The Postgres trigger recomputes the `tsv` column from those scalar
 * fields, so we only set title/bodyText here.
 *
 * Resilient by contract: returns `false` (and never throws) for a malformed
 * document name or a missing page, so the caller can treat indexing as
 * best-effort and never let it break primary persistence. The body text is
 * extracted defensively (a corrupt state yields "").
 */
export async function indexPageBody(
  prisma: CollabPrisma,
  documentName: string,
  state: Uint8Array,
): Promise<boolean> {
  const pageId = documentNameToPageId(documentName);
  if (!pageId) return false;

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { workspaceId: true, title: true },
  });
  if (!page) return false;

  const bodyText = extractPlainTextFromUpdate(state);
  await prisma.searchIndex.upsert({
    where: { pageId },
    create: { pageId, workspaceId: page.workspaceId, title: page.title, bodyText },
    update: { workspaceId: page.workspaceId, title: page.title, bodyText },
  });
  return true;
}
