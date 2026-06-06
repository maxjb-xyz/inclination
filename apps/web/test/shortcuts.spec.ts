import { describe, expect, it, vi } from "vitest";
import {
  isEditableTarget,
  matchesShortcut,
  resolveShortcut,
  type Shortcut,
} from "../src/shortcuts/shortcuts";

function ev(init: Partial<KeyboardEventInit> & { key: string }, target?: EventTarget): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { bubbles: true, ...init });
  if (target) Object.defineProperty(e, "target", { value: target, configurable: true });
  return e;
}

const palette: Shortcut = {
  id: "palette",
  key: "k",
  meta: true,
  global: true,
  description: "palette",
  run: vi.fn(),
};
const sidebar: Shortcut = {
  id: "sidebar",
  key: "\\",
  meta: true,
  description: "sidebar",
  run: vi.fn(),
};
const theme: Shortcut = {
  id: "theme",
  key: "l",
  meta: true,
  shift: true,
  description: "theme",
  run: vi.fn(),
};

describe("matchesShortcut", () => {
  it("matches a meta+key combo with either ctrl or meta", () => {
    expect(matchesShortcut(ev({ key: "k", metaKey: true }), palette)).toBe(true);
    expect(matchesShortcut(ev({ key: "k", ctrlKey: true }), palette)).toBe(true);
  });

  it("does not match without the modifier", () => {
    expect(matchesShortcut(ev({ key: "k" }), palette)).toBe(false);
  });

  it("respects shift", () => {
    expect(matchesShortcut(ev({ key: "l", metaKey: true, shiftKey: true }), theme)).toBe(true);
    expect(matchesShortcut(ev({ key: "l", metaKey: true }), theme)).toBe(false);
  });
});

describe("isEditableTarget", () => {
  it("treats inputs/textareas as editable", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
  });

  it("treats a .ProseMirror descendant as editable", () => {
    const pm = document.createElement("div");
    pm.className = "ProseMirror";
    const child = document.createElement("span");
    pm.appendChild(child);
    expect(isEditableTarget(child)).toBe(true);
  });

  it("treats a plain div as not editable", () => {
    expect(isEditableTarget(document.createElement("div"))).toBe(false);
  });
});

describe("resolveShortcut", () => {
  const all = [palette, sidebar, theme];

  it("fires the matching shortcut on a non-editable target", () => {
    const div = document.createElement("div");
    expect(resolveShortcut(ev({ key: "\\", metaKey: true }, div), all)?.id).toBe("sidebar");
  });

  it("suppresses non-global shortcuts inside the editor", () => {
    const pm = document.createElement("div");
    pm.className = "ProseMirror";
    // ⌘\ (non-global) is suppressed inside the editor.
    expect(resolveShortcut(ev({ key: "\\", metaKey: true }, pm), all)).toBeNull();
  });

  it("still fires global shortcuts (⌘K) inside the editor", () => {
    const pm = document.createElement("div");
    pm.className = "ProseMirror";
    expect(resolveShortcut(ev({ key: "k", metaKey: true }, pm), all)?.id).toBe("palette");
  });
});
