import path from "node:path";

import { config } from "dotenv";
import { defineConfig } from "vitest/config";

import { FIT_COACH_DIR } from "./src/fitCoachDir";

config({ path: path.join(FIT_COACH_DIR, ".env.local"), quiet: true });

export default defineConfig({
  test: {
    include: ["src/**/*.eval.ts"],
    setupFiles: ["./src/setup.ts"],
    fileParallelism: false,
    testTimeout: 24 * 60 * 60 * 1000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@": path.join(FIT_COACH_DIR, "src"),
      "server-only": path.join(FIT_COACH_DIR, "src", "test", "serverOnly.ts"),
    },
  },
});
