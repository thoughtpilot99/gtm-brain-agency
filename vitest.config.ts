import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/test/**/*.test.ts"],
    setupFiles: ["packages/core/test/setup.ts"],
    testTimeout: 30000,
    fileParallelism: false,
  },
});
