import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@inclination/shared": resolve(__dirname, "../../packages/shared/src/index.ts"),
      "@inclination/editor": resolve(__dirname, "../../packages/editor/src/index.ts"),
    },
  },
  server: {
    proxy: {
      "/api": { target: "http://localhost:3001", changeOrigin: true },
      "/collab": { target: "ws://localhost:3002", ws: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
