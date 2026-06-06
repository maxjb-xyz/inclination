import "@testing-library/jest-dom/vitest";

// jsdom here does not provide a usable localStorage (it throws SecurityError),
// which the zustand persist middleware needs. Provide an in-memory polyfill.
const store = new Map<string, string>();
const memoryStorage: Storage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => {
    store.set(key, String(value));
  },
  removeItem: (key) => {
    store.delete(key);
  },
  clear: () => {
    store.clear();
  },
  key: (index) => Array.from(store.keys())[index] ?? null,
  get length() {
    return store.size;
  },
};
Object.defineProperty(globalThis, "localStorage", {
  value: memoryStorage,
  configurable: true,
});

// jsdom does not implement layout, so ProseMirror's selection/scroll machinery
// (coordsAtPos -> getClientRects/getBoundingClientRect) throws when Tiptap
// dispatches a transaction. Provide inert stubs so editor component tests can
// drive real edits without crashing.
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  }) as unknown as DOMRectList;
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}
if (!Element.prototype.getClientRects) {
  Element.prototype.getClientRects = () => ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  }) as unknown as DOMRectList;
}
if (!document.elementFromPoint) {
  document.elementFromPoint = () => null;
}
