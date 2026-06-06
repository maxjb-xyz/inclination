import { useEffect, useState } from "react";
import { createCollabSession, type CollabSession } from "./session";

/** Connection state surfaced to the UI, derived from the provider status. */
export type CollabStatus = "connecting" | "connected" | "offline";

export interface UseCollabSessionResult {
  /** The active session, or null until the first one is created. */
  session: CollabSession | null;
  /** Human-facing connection state for the presence indicator. */
  status: CollabStatus;
  /** Number of OTHER connected collaborators (excludes the local user). */
  peers: number;
}

/**
 * Manage a per-page collaboration session and expose its connection status.
 *
 * A fresh {@link CollabSession} (Y.Doc + provider + IndexedDB) is created for
 * each `pageId` and torn down when the page changes or the component unmounts —
 * so there is never cross-page doc reuse or a leaked websocket. Connection
 * status comes from the provider's `status` event; peer count from awareness.
 */
export function useCollabSession(pageId: string, token: string): UseCollabSessionResult {
  const [session, setSession] = useState<CollabSession | null>(null);
  const [status, setStatus] = useState<CollabStatus>("connecting");
  const [peers, setPeers] = useState(0);

  useEffect(() => {
    const created = createCollabSession({ pageId, token });
    setSession(created);
    setStatus("connecting");
    setPeers(0);

    const onStatus = (event: { status: string }): void => {
      setStatus(event.status === "connected" ? "connected" : "offline");
    };
    // The provider's awareness tracks every connected client (including us), so
    // "other" collaborators is the field count minus one.
    const onAwareness = (): void => {
      const count = created.provider.awareness?.getStates().size ?? 1;
      setPeers(Math.max(0, count - 1));
    };

    created.provider.on("status", onStatus);
    created.provider.awareness?.on("change", onAwareness);
    onAwareness();

    return () => {
      created.provider.off("status", onStatus);
      created.provider.awareness?.off("change", onAwareness);
      created.destroy();
      setSession(null);
    };
    // Recreate only when the page or token identity changes.
  }, [pageId, token]);

  return { session, status, peers };
}
