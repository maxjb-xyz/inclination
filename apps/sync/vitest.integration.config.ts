import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve workspace packages to source so tests run without a prior build.
  resolve: {
    alias: {
      "@inclination/shared": resolve(__dirname, "../../packages/shared/src/index.ts"),
      "@inclination/db": resolve(__dirname, "../../packages/db/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.integration.spec.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
