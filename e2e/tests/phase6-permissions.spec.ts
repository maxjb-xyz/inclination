import { expect, test, type APIRequestContext } from "@playwright/test";
import { authHeader, registerVerifyLogin } from "./helpers";

/**
 * Phase 6 "Done when" gate (spec §8): a guest invited to ONE page sees only that
 * subtree — enforced at BOTH the API and the sync (Hocuspocus) layers — and
 * comments with @-mentions notify the right users.
 *
 * Everything is driven through the real REST API against the running stack
 * (Caddy → API + sync + Postgres + Mailpit), which is the most robust way to set
 * up the fixture deterministically:
 *
 *   OWNER  → workspace W, page A, child A1 (parent A), separate page B.
 *   GUEST  → a distinct account, NOT a member of W until invited.
 *   share-invite A→guest (role 'read') makes the guest a guest-member of W with a
 *   Permission grant on A only.
 *
 * We then assert guest scoping at:
 *   - the API layer (GET/PATCH against A, A1, B; GET /access),
 *   - the SYNC layer (open a Hocuspocus websocket to wss://…/collab for `page:B`
 *     and `page:A` with the guest's token; B must be rejected, A accepted), and
 *   - notifications (owner @-mentions the guest in a comment on A → guest's
 *     /api/notifications gains a `mention` referencing A; unread-count ≥ 1).
 *
 * SYNC-LAYER METHOD: we drive the real `@hocuspocus/provider` (the same client
 * the web app uses) from the test. The provider exposes `onAuthenticated` and
 * `onAuthenticationFailed` callbacks which fire off the server's `onAuthenticate`
 * hook — that hook runs the SHARED `resolvePageAccess` resolver, so observing
 * authenticated-vs-failed proves per-page authorization at the sync layer. The
 * provider package is not an e2e dependency, so we import its built ESM bundle
 * from the web workspace by an `import.meta.url`-relative path (stable pnpm
 * symlink) and use Node's global WebSocket (Node ≥ 22). A raw-WebSocket fallback
 * would require hand-encoding the Hocuspocus/lib0 handshake; the real provider is
 * both simpler and a higher-fidelity check, so we use it.
 */

// REST setup + the websocket handshake go through Caddy; give them headroom.
const SYNC_TIMEOUT = 20_000;

/**
 * HTTPS-first (Phase 9): the sync server is reached over wss through Caddy (TLS
 * on https://localhost:8443). Derive the collab ws(s) URL from BASE_URL so the
 * gate can retarget the stack; default to wss://localhost:8443/collab.
 */
const COLLAB_WS_URL = (() => {
  const base = process.env.BASE_URL ?? "https://localhost:8443";
  return `${base.replace(/^http/, "ws").replace(/\/$/, "")}/collab`;
})();

// TEST-ONLY: the Node `ws` client this spec uses to open the wss collab
// connection rejects the self-signed "Caddy internal" localhost cert by default.
// Accept it for this test run only. This mirrors Playwright's `ignoreHTTPSErrors`
// for the browser side and is NOT a backend change — the TLS itself is real.
if (COLLAB_WS_URL.startsWith("wss://")) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

/** Loaded once: the web app's HocuspocusProvider bundle (no e2e dep needed). */
type ProviderModule = {
  HocuspocusProvider: new (config: Record<string, unknown>) => { destroy(): void };
  HocuspocusProviderWebsocket: new (config: { url: string }) => { destroy(): void };
};

async function loadProvider(): Promise<ProviderModule> {
  const url = new URL(
    "../../apps/web/node_modules/@hocuspocus/provider/dist/hocuspocus-provider.esm.js",
    import.meta.url,
  );
  return (await import(url.href)) as unknown as ProviderModule;
}

type ConnectOutcome = "authenticated" | "auth-failed" | "timeout";

/**
 * Open a Hocuspocus collab connection for `page:{pageId}` with the given access
 * token and resolve how the server's per-page auth hook responded:
 *   - "authenticated": onAuthenticated (or onSynced) fired → access granted.
 *   - "auth-failed":   onAuthenticationFailed fired → access denied.
 *   - "timeout":       neither within the timeout (treated as a failure).
 * The provider/socket are always torn down before resolving.
 */
async function collabConnect(
  provider: ProviderModule,
  pageId: string,
  token: string,
  timeoutMs = SYNC_TIMEOUT,
): Promise<ConnectOutcome> {
  return new Promise<ConnectOutcome>((resolve) => {
    const socket = new provider.HocuspocusProviderWebsocket({
      // HTTPS-first (Phase 9): the sync server is reached over wss through Caddy
      // (TLS on 8443). Derived from BASE_URL so the gate can retarget the stack;
      // the Node `ws` client accepts the self-signed localhost cert because the
      // suite sets NODE_TLS_REJECT_UNAUTHORIZED=0 (test-only; see file header).
      url: COLLAB_WS_URL,
    });
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    const hp = new provider.HocuspocusProvider({
      websocketProvider: socket,
      name: `page:${pageId}`,
      token,
      onAuthenticated: () => finish("authenticated"),
      onSynced: () => finish("authenticated"),
      onAuthenticationFailed: () => finish("auth-failed"),
    });
    function finish(outcome: ConnectOutcome): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        hp.destroy();
      } catch {
        /* ignore teardown errors */
      }
      try {
        socket.destroy();
      } catch {
        /* ignore teardown errors */
      }
      resolve(outcome);
    }
    timer = setTimeout(() => finish("timeout"), timeoutMs);
  });
}

/** GET a JSON body, asserting an exact status and surfacing the body on mismatch. */
async function expectStatus(
  ctx: APIRequestContext,
  method: "get" | "patch" | "put",
  path: string,
  token: string,
  expected: number,
  data?: unknown,
): Promise<unknown> {
  const opts = data !== undefined ? { ...authHeader(token), data } : authHeader(token);
  const res = await ctx[method](path, opts);
  if (res.status() !== expected) {
    const body = await res.text();
    throw new Error(`${method.toUpperCase()} ${path} → ${res.status()} (expected ${expected}): ${body}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

test("guest is scoped to the shared subtree at the API and sync layers, and mentions notify", async ({
  request,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();

  // 1. OWNER: register → verify → login, then build the page tree.
  const owner = await registerVerifyLogin(request, {
    email: `owner-${stamp}@example.com`,
    password: "ownerpassword1",
    displayName: "Owner",
  });
  const ownerTok = owner.tokens.accessToken;

  const wsRes = await request.post("/api/workspaces", {
    ...authHeader(ownerTok),
    data: { name: "Sharing Workspace" },
  });
  expect(wsRes.status(), await wsRes.text()).toBe(201);
  const wsId = (await wsRes.json()).id as string;

  const mkPage = async (title: string, parentId?: string): Promise<string> => {
    const res = await request.post(`/api/workspaces/${wsId}/pages`, {
      ...authHeader(ownerTok),
      data: { title, ...(parentId ? { parentId } : {}) },
    });
    expect(res.status(), await res.text()).toBe(201);
    return (await res.json()).id as string;
  };
  const pageA = await mkPage(`Page A ${stamp}`);
  const pageA1 = await mkPage(`Page A1 ${stamp}`, pageA);
  const pageB = await mkPage(`Page B ${stamp}`);

  // 2. GUEST: a separate, verified account that is NOT yet a member of W.
  const guest = await registerVerifyLogin(request, {
    email: `guest-${stamp}@example.com`,
    password: "guestpassword1",
    displayName: "Guest",
  });
  const guestTok = guest.tokens.accessToken;
  const guestId = guest.user.id;

  // Sanity: before sharing, the guest can read NOTHING in W (no grant, no default).
  await expectStatus(request, "get", `/api/pages/${pageA}`, guestTok, 403);

  // 3. OWNER shares page A with the guest as a reader → guest-member + grant on A.
  const inviteRes = await request.post(`/api/pages/${pageA}/share-invite`, {
    ...authHeader(ownerTok),
    data: { email: `guest-${stamp}@example.com`, role: "read" },
  });
  expect(inviteRes.status(), await inviteRes.text()).toBe(201);
  const invite = (await inviteRes.json()) as { kind: string; userId?: string };
  expect(invite.kind).toBe("granted");
  expect(invite.userId).toBe(guestId);

  // 4. API-LAYER guest scoping.
  // Granted page A and its descendant A1 are readable; the unrelated B is not.
  await expectStatus(request, "get", `/api/pages/${pageA}`, guestTok, 200);
  await expectStatus(request, "get", `/api/pages/${pageA1}`, guestTok, 200); // descendant inherits
  await expectStatus(request, "get", `/api/pages/${pageB}`, guestTok, 403); // no grant → no access

  // Resolved capabilities: read-only on A.
  const access = (await expectStatus(request, "get", `/api/pages/${pageA}/access`, guestTok, 200)) as {
    canRead: boolean;
    canWrite: boolean;
  };
  expect(access.canRead).toBe(true);
  expect(access.canWrite).toBe(false);

  // A write as the read-only guest is rejected (meta PATCH and content PUT).
  await expectStatus(request, "patch", `/api/pages/${pageA}`, guestTok, 403, { title: "hijacked" });
  await expectStatus(request, "put", `/api/pages/${pageA}/content`, guestTok, 403, {
    doc: { type: "doc", content: [] },
  });

  // The guest cannot read B by any page route — the scoping boundary. (A guest is
  // a workspace member so it MAY enumerate the page list, but it cannot read B's
  // contents; the read gate above is the actual access boundary the gate asserts.)
  await expectStatus(request, "get", `/api/pages/${pageB}/content`, guestTok, 403);

  // 5. SYNC-LAYER guest scoping via the real Hocuspocus provider.
  const provider = await loadProvider();
  const [bOutcome, aOutcome] = await Promise.all([
    collabConnect(provider, pageB, guestTok),
    collabConnect(provider, pageA, guestTok),
  ]);
  expect(bOutcome, "guest collab to page B must be rejected by the sync auth hook").toBe(
    "auth-failed",
  );
  expect(aOutcome, "guest collab to page A must be accepted by the sync auth hook").toBe(
    "authenticated",
  );

  // 6. Comment mention notifies the guest.
  const commentBody = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "mention", attrs: { kind: "user", id: guestId, label: "Guest" } }],
      },
    ],
  };
  const commentRes = await request.post(`/api/pages/${pageA}/comments`, {
    ...authHeader(ownerTok),
    data: { body: commentBody },
  });
  expect(commentRes.status(), await commentRes.text()).toBe(201);

  // The guest's inbox now carries a `mention` notification referencing page A.
  const notifications = (await expectStatus(
    request,
    "get",
    `/api/notifications`,
    guestTok,
    200,
  )) as { type: string; sourceRef: { pageId?: string } | null }[];
  const mention = notifications.find(
    (n) => n.type === "mention" && n.sourceRef?.pageId === pageA,
  );
  expect(mention, `expected a mention notification for page A, got: ${JSON.stringify(notifications)}`).toBeTruthy();

  const unread = (await expectStatus(
    request,
    "get",
    `/api/notifications/unread-count`,
    guestTok,
    200,
  )) as { count: number };
  expect(unread.count).toBeGreaterThanOrEqual(1);
});
