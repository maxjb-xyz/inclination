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
