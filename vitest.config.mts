import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Plain TypeScript logic (matching, caps, state machine) is tested in node.
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/rls/**/*.test.ts"],
  },
  resolve: {
    // Same "@/..." import alias as the app.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});
