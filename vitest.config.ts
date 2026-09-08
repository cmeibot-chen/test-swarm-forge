import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["test/**/*.property.test.ts"],
    coverage: {
      provider: "istanbul",
      reporter: ["json"],
      reportsDirectory: "coverage",
      include: ["lib/**/*.ts"],
      exclude: ["lib/db.ts"],
      clean: true,
    },
  },
});
