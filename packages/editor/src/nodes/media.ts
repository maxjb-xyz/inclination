import { mergeAttributes, Node } from "@tiptap/core";
import { isSafeUrl } from "../url";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mediaBlocks: {
      /** Insert a file-attachment block (URL-based; upload is Phase 7). */
      setFileBlock: (attrs?: { src?: string; title?: string }) => ReturnType;
      /** Insert a video block (URL-based). */
      setVideoBlock: (attrs?: { src?: string; title?: string }) => ReturnType;
      /** Insert a bookmark / link-preview block. */
      setBookmark: (attrs?: { src?: string; title?: string }) => ReturnType;
      /** Insert a generic iframe embed block. */
      setEmbed: (attrs?: { src?: string; title?: string }) => ReturnType;
    };
  }
}

interface MediaNodeConfig {
  name: string;
  /** The `data-type` attribute used for (de)serialization. */
  dataType: string;
}

/**
 * Build a URL-based media atom node (file / video / bookmark / embed). All share
 * the same shape: a `src` URL plus an optional `title`, serialized to
 * `<div data-type="…" data-src data-title>` so they round-trip through Yjs
 * without a NodeView. Actual upload to MinIO is Phase 7 — Phase 4 takes a URL.
 * The web app supplies React NodeViews for rich rendering (thumbnails, iframes).
 */
function createMediaNode(config: MediaNodeConfig): Node {
  return Node.create({
    name: config.name,
    group: "block",
    atom: true,
    selectable: true,
    draggable: true,

    addAttributes() {
      return {
        src: {
          default: "",
          // Drop unsafe schemes (javascript:/data:/…) on parse so a malicious
          // serialized doc can't reintroduce an executable URL into the model.
          parseHTML: (element) => {
            const value = element.getAttribute("data-src") ?? "";
            return isSafeUrl(value) ? value : "";
          },
          // Only ever serialize a safe URL into the stored/round-tripped HTML.
          renderHTML: (attributes) => {
            const value = attributes.src as string;
            return { "data-src": isSafeUrl(value) ? value : "" };
          },
        },
        title: {
          default: "",
          parseHTML: (element) => element.getAttribute("data-title") ?? "",
          renderHTML: (attributes) => ({ "data-title": attributes.title as string }),
        },
      };
    },

    parseHTML() {
      return [{ tag: `div[data-type="${config.dataType}"]` }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { "data-type": config.dataType })];
    },
  });
}

export const FileBlock = createMediaNode({ name: "fileBlock", dataType: "file" }).extend({
  addCommands() {
    return {
      setFileBlock:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({ type: "fileBlock", attrs }),
    };
  },
});

export const VideoBlock = createMediaNode({ name: "videoBlock", dataType: "video" }).extend({
  addCommands() {
    return {
      setVideoBlock:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({ type: "videoBlock", attrs }),
    };
  },
});

export const Bookmark = createMediaNode({ name: "bookmark", dataType: "bookmark" }).extend({
  addCommands() {
    return {
      setBookmark:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({ type: "bookmark", attrs }),
    };
  },
});

export const Embed = createMediaNode({ name: "embed", dataType: "embed" }).extend({
  addCommands() {
    return {
      setEmbed:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({ type: "embed", attrs }),
    };
  },
});
