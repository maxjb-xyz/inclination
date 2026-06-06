import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/core";
import { extractPageReferences } from "@inclination/editor";
import { debounce } from "../pages/debounce";

/** Stable equality for two ordered id lists (refs are deduped + ordered). */
function sameRefs(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Pure reference-sync core (no React) so it is unit-testable. Returns a
 * debounced `sync` to call on document change and the predicate it uses
 * internally; `sync` computes the referenced page ids from the doc JSON and
 * PUTs them, skipping when unchanged from the last successful sync.
 */
export function createReferenceSync(opts: {
  pageId: string;
  getDoc: () => unknown;
  putReferences: (pageId: string, pageIds: string[]) => Promise<unknown>;
  wait?: number;
  /** Seeds the "last synced" set so an initial unchanged doc doesn't PUT. */
  initialRefs?: string[];
}): { sync: () => void; flush: () => void; cancel: () => void } {
  let last: string[] | null = opts.initialRefs ?? null;

  const run = (): void => {
    const refs = extractPageReferences(opts.getDoc() as never);
    if (last !== null && sameRefs(last, refs)) return;
    last = refs;
    void opts.putReferences(opts.pageId, refs).catch(() => {
      // On failure, clear the cache so the next change retries the PUT.
      last = null;
    });
  };

  const debounced = debounce(run, opts.wait ?? 800);
  return { sync: () => debounced(), flush: () => debounced.flush(), cancel: () => debounced.cancel() };
}

/**
 * Wire reference syncing to a live editor: on every document change, debounce
 * (~800ms) then compute `extractPageReferences(editor.getJSON())` and PUT the
 * deduped page ids, skipping when unchanged. Collaboration-safe — it only reads
 * the doc and never mutates it. Seeds the last-synced set from the initial doc
 * so opening a page does not emit a redundant PUT.
 */
export function useReferenceSync(
  editor: Editor | null,
  pageId: string,
  putReferences: (pageId: string, pageIds: string[]) => Promise<unknown>,
): void {
  // Keep the latest putReferences without re-subscribing the editor listener.
  const putRef = useRef(putReferences);
  putRef.current = putReferences;

  useEffect(() => {
    if (!editor) return;

    const controller = createReferenceSync({
      pageId,
      getDoc: () => editor.getJSON(),
      putReferences: (id, ids) => putRef.current(id, ids),
      initialRefs: extractPageReferences(editor.getJSON() as never),
    });

    const onUpdate = (): void => controller.sync();
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
      controller.cancel();
    };
  }, [editor, pageId]);
}
