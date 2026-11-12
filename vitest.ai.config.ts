import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/ai-model.live.test.ts"],
    environment: "node",
    testTimeout: 180_000,
  },
});
