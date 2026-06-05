import { resolve } from "node:path";
import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  resolve: {
    alias: {
      "@inclination/shared": resolve(__dirname, "../../packages/shared/src/index.ts"),
      "@inclination/db": resolve(__dirname, "../../packages/db/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["test/setup.ts"],
    include: ["test/**/*.integration.spec.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
