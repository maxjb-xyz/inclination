import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks: never open a real websocket or IndexedDB connection in unit tests.

interface ProviderArgs {
  url: string;
  name: string;
  token: string;
  document: unknown;
}

const providerInstances: Array<{ args: ProviderArgs; destroy: ReturnType<typeof vi.fn> }> = [];

vi.mock("@hocuspocus/provider", () => {
  class FakeAwareness {
    private listeners = new Map<string, Set<() => void>>();
    on(event: string, cb: () => void): void {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event)!.add(cb);
    }
    off(event: string, cb: () => void): void {
      this.listeners.get(event)?.delete(cb);
    }
    getStates(): Map<number, unknown> {
      return new Map([[1, { user: { name: "me" } }]]);
    }
  }
  class HocuspocusProvider {
    awareness = new FakeAwareness();
    destroy = vi.fn();
    private statusListeners = new Set<(e: { status: string }) => void>();
    constructor(args: ProviderArgs) {
      providerInstances.push({ args, destroy: this.destroy });
    }
    on(event: string, cb: (e: { status: string }) => void): void {
      if (event === "status") this.statusListeners.add(cb);
    }
    off(event: string, cb: (e: { status: string }) => void): void {
      if (event === "status") this.statusListeners.delete(cb);
    }
  }
  return { HocuspocusProvider };
});

const indexeddbDestroy = vi.fn();
vi.mock("y-indexeddb", () => {
  class IndexeddbPersistence {
    destroy = indexeddbDestroy;
    constructor(
      public name: string,
      public doc: unknown,
    ) {}
  }
  return { IndexeddbPersistence };
});

import { createCollabSession } from "../src/collab/session";
import { useCollabSession } from "../src/collab/useCollabSession";

beforeEach(() => {
  providerInstances.length = 0;
  indexeddbDestroy.mockClear();
});
afterEach(cleanup);

describe("createCollabSession", () => {
  it("builds the provider with name page:{id} and the access token", () => {
    const session = createCollabSession({
      pageId: "page-123",
      token: "access-token-abc",
      url: "ws://localhost/collab",
    });

    expect(providerInstances).toHaveLength(1);
    expect(providerInstances[0]!.args.name).toBe("page:page-123");
    expect(providerInstances[0]!.args.token).toBe("access-token-abc");
    expect(providerInstances[0]!.args.url).toBe("ws://localhost/collab");
    // The provider, persistence, and doc all share the same Y.Doc instance.
    expect(providerInstances[0]!.args.document).toBe(session.doc);

    session.destroy();
    expect(providerInstances[0]!.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroy is idempotent (page switch + unmount both fire)", () => {
    const session = createCollabSession({ pageId: "p", token: "t", url: "ws://x/collab" });
    session.destroy();
    session.destroy();
    expect(providerInstances[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(indexeddbDestroy).toHaveBeenCalledTimes(1);
  });
});

describe("useCollabSession", () => {
  function Harness({ pageId, token }: { pageId: string; token: string }): React.ReactElement {
    const { session } = useCollabSession(pageId, token);
    return <div data-testid="doc-name">{session ? session.pageId : "none"}</div>;
  }

  it("tears down the previous provider/doc when pageId changes", () => {
    const { rerender } = render(<Harness pageId="A" token="tok" />);

    expect(providerInstances).toHaveLength(1);
    expect(providerInstances[0]!.args.name).toBe("page:A");
    expect(providerInstances[0]!.destroy).not.toHaveBeenCalled();

    // Switch page → the first session must be destroyed and a new one created.
    rerender(<Harness pageId="B" token="tok" />);

    expect(providerInstances).toHaveLength(2);
    expect(providerInstances[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(providerInstances[1]!.args.name).toBe("page:B");
    expect(providerInstances[1]!.destroy).not.toHaveBeenCalled();
  });

  it("passes the freshest token at connect time", () => {
    const { rerender } = render(<Harness pageId="A" token="old-token" />);
    expect(providerInstances[0]!.args.token).toBe("old-token");

    rerender(<Harness pageId="A" token="new-token" />);
    // A token change recreates the session with the new token.
    expect(providerInstances).toHaveLength(2);
    expect(providerInstances[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(providerInstances[1]!.args.token).toBe("new-token");
  });
});
