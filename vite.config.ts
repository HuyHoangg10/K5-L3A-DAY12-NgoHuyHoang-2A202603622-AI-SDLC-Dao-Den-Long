import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  build: { outDir: "dist/web", emptyOutDir: true, chunkSizeWarningLimit: 900 },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 30000 },
});
