import * as Y from "yjs";
import type { ProseMirrorNodeJSON } from "@inclination/editor";

/**
 * Decode a stored Yjs page-body update into ProseMirror-JSON via a structured
 * walk of the Yjs XML fragment (the same `default` fragment Tiptap's
 * Collaboration extension binds to — see apps/sync/src/extract.ts).
 *
 * We avoid pulling in `y-prosemirror` (which needs the full PM schema + a DOM):
 * the export pipeline only needs a faithful-enough block/inline tree to hand to
 * `proseMirrorToMarkdown`. A `Y.XmlElement`'s `nodeName` is the PM node type and
 * its attributes are the PM attrs; `Y.XmlText` carries text plus formatting
 * attributes (deltas) which map to PM marks. Anything unrecognized degrades to
 * its text, so export never throws on an exotic block.
 *
 * Resilient by contract: a corrupt/empty state yields an empty doc.
 */

const PROSE_FRAGMENT_FIELD = "default";

/** Map a Yjs XmlText delta attributes object to ProseMirror marks. */
function attrsToMarks(attributes: Record<string, unknown> | undefined): unknown[] | undefined {
  if (!attributes) return undefined;
  const marks: { type: string; attrs?: Record<string, unknown> }[] = [];
  for (const [key, value] of Object.entries(attributes)) {
    if (!value) continue;
    switch (key) {
      case "bold":
      case "italic":
      case "strike":
      case "code":
        marks.push({ type: key });
        break;
      case "link": {
        // y-prosemirror stores link as an object of attrs (e.g. { href }).
        const attrs =
          value && typeof value === "object" ? (value as Record<string, unknown>) : {};
        marks.push({ type: "link", attrs });
        break;
      }
      default:
        break;
    }
  }
  return marks.length ? marks : undefined;
}

/** Convert a Y.XmlText node into one or more PM text nodes (per delta run). */
function xmlTextToNodes(node: Y.XmlText): ProseMirrorNodeJSON[] {
  const delta = node.toDelta() as { insert?: unknown; attributes?: Record<string, unknown> }[];
  const out: ProseMirrorNodeJSON[] = [];
  for (const run of delta) {
    if (typeof run.insert !== "string" || run.insert.length === 0) continue;
    const marks = attrsToMarks(run.attributes);
    out.push({ type: "text", text: run.insert, ...(marks ? { marks } : {}) } as ProseMirrorNodeJSON);
  }
  return out;
}

/** Convert a single Yjs XML element to a PM node. */
function xmlElementToNode(el: Y.XmlElement): ProseMirrorNodeJSON {
  const type = el.nodeName;
  const rawAttrs = el.getAttributes() as Record<string, unknown>;
  const attrs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawAttrs)) {
    if (v !== null && v !== undefined) attrs[k] = v;
  }

  const content: ProseMirrorNodeJSON[] = [];
  for (const child of el.toArray()) {
    if (child instanceof Y.XmlText) {
      content.push(...xmlTextToNodes(child));
    } else if (child instanceof Y.XmlElement) {
      content.push(xmlElementToNode(child));
    }
  }

  return {
    type,
    ...(Object.keys(attrs).length ? { attrs } : {}),
    ...(content.length ? { content } : {}),
  } as ProseMirrorNodeJSON;
}

/**
 * Decode a Yjs page-body state binary into ProseMirror `doc` JSON. Returns an
 * empty doc on any failure or when there is no content.
 */
export function ydocStateToProseMirror(state: Uint8Array | null | undefined): ProseMirrorNodeJSON {
  const empty: ProseMirrorNodeJSON = { type: "doc", content: [] };
  if (!state || state.length === 0) return empty;
  try {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const fragment = doc.getXmlFragment(PROSE_FRAGMENT_FIELD);
    const content: ProseMirrorNodeJSON[] = [];
    for (const child of fragment.toArray()) {
      if (child instanceof Y.XmlElement) content.push(xmlElementToNode(child));
      else if (child instanceof Y.XmlText) content.push(...xmlTextToNodes(child));
    }
    doc.destroy();
    return { type: "doc", content };
  } catch {
    return empty;
  }
}
