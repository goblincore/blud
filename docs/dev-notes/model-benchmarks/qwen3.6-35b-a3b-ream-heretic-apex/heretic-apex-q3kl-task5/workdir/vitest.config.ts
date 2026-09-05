import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["lru-cache.test.ts"] },
});
