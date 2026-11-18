import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests: real supabase-js clients against the LOCAL Supabase stack
// (npm run stack:up). Run with npm run test:integration. They are kept out of
// the normal `npm test`, which must stay fast and need no Docker.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // One file at a time: they share one database and some tests count rows.
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});
