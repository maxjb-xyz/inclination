import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve workspace packages to source so unit tests run straight after
  // `pnpm install`, without requiring the packages to be built first.
  resolve: {
    alias: {
      "@inclination/shared": resolve(__dirname, "../../packages/shared/src/index.ts"),
      "@inclination/db": resolve(__dirname, "../../packages/db/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.spec.ts"],
    // Integration specs (Testcontainers) are opt-in via `test:integration` so the
    // default unit run stays fast and Docker-free.
    exclude: ["test/**/*.integration.spec.ts", "node_modules/**", "dist/**"],
  },
});
