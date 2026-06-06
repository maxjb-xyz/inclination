import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks: never open a real websocket or IndexedDB in unit tests.
interface ProviderArgs {
  url: string;
  name: string;
  token: string;
  document: unknown;
}
const providerInstances: Array<{ args: ProviderArgs; destroy: ReturnType<typeof vi.fn> }> = [];

vi.mock("@hocuspocus/provider", () => {
  class FakeAwareness {
    states = new Map<number, unknown>();
    setLocalStateField(): void {}
    getLocalState(): unknown {
      return {};
    }
    getStates(): Map<number, unknown> {
      return this.states;
    }
    on(): void {}
    off(): void {}
  }
  class HocuspocusProvider {
    awareness = new FakeAwareness();
    destroy = vi.fn();
    document: unknown;
    constructor(args: ProviderArgs) {
      this.document = args.document;
      providerInstances.push({ args, destroy: this.destroy });
    }
    on(): void {}
    off(): void {}
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

import { createSyncedSession } from "../src/collab/session";
import { syncedDocName } from "../src/collab/docName";
import { SyncedBlockView } from "../src/editor/SyncedBlockView";
import { SyncedBlockEditorContext } from "../src/editor/syncedBlockContext";
import { filterWebSlashMenuItems } from "../src/editor/slashSuggestion";

beforeEach(() => {
  providerInstances.length = 0;
  indexeddbDestroy.mockClear();
});
afterEach(cleanup);

describe("syncedDocName", () => {
  it("builds the `synced:{id}` doc name the sync server parses", () => {
    expect(syncedDocName("sb-123")).toBe("synced:sb-123");
  });
});

describe("createSyncedSession", () => {
  it("builds a provider for synced:{id} with the token and tears down idempotently", () => {
    const session = createSyncedSession({
      syncedBlockId: "sb-1",
      token: "tok",
      url: "ws://localhost/collab",
    });
    expect(providerInstances).toHaveLength(1);
    expect(providerInstances[0]!.args.name).toBe("synced:sb-1");
    expect(providerInstances[0]!.args.token).toBe("tok");
    expect(providerInstances[0]!.args.document).toBe(session.doc);

    session.destroy();
    session.destroy();
    expect(providerInstances[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(indexeddbDestroy).toHaveBeenCalledTimes(1);
  });
});

describe("slash action", () => {
  it("offers a 'Synced block' item", () => {
    const items = filterWebSlashMenuItems("synced");
    expect(items.map((i) => i.id)).toContain("syncedBlock");
  });
});

// A minimal NodeViewProps stand-in for the synced-block view.
function makeNodeViewProps(
  syncedBlockId: string | null,
  updateAttributes = vi.fn(),
): React.ComponentProps<typeof SyncedBlockView> {
  return {
    node: { attrs: { syncedBlockId } },
    updateAttributes,
    editor: { isEditable: true },
  } as unknown as React.ComponentProps<typeof SyncedBlockView>;
}

const ctx = {
  workspaceId: "ws1",
  token: "tok",
  userName: "Alice",
  userColor: "#abcdef",
  createSyncedBlock: vi.fn(async () => "sb-new"),
};

describe("SyncedBlockView", () => {
  it("creates a synced block when the empty node's button is clicked", async () => {
    const updateAttributes = vi.fn();
    render(
      <SyncedBlockEditorContext.Provider value={ctx}>
        <SyncedBlockView {...makeNodeViewProps(null, updateAttributes)} />
      </SyncedBlockEditorContext.Provider>,
    );
    const btn = screen.getByTestId("synced-block-create");
    await act(async () => {
      btn.click();
    });
    await waitFor(() => expect(ctx.createSyncedBlock).toHaveBeenCalled());
    await waitFor(() => expect(updateAttributes).toHaveBeenCalledWith({ syncedBlockId: "sb-new" }));
  });

  it("mounts a nested collab provider for synced:{id} and tears it down on unmount", async () => {
    const { unmount } = render(
      <SyncedBlockEditorContext.Provider value={ctx}>
        <SyncedBlockView {...makeNodeViewProps("sb-9")} />
      </SyncedBlockEditorContext.Provider>,
    );

    await waitFor(() => expect(providerInstances).toHaveLength(1));
    expect(providerInstances[0]!.args.name).toBe("synced:sb-9");
    expect(providerInstances[0]!.destroy).not.toHaveBeenCalled();

    unmount();
    await waitFor(() => expect(providerInstances[0]!.destroy).toHaveBeenCalledTimes(1));
  });
});
