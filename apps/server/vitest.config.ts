import { defineProject } from "vitest/config";

export default defineProject({
  test: { include: ["src/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 60_000 },
});
