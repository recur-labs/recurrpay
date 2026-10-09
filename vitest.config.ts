import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // Point workspace imports at source so `pnpm test` works on a fresh clone
    // without a build step. `pnpm build` still resolves through dist.
    alias: [
      { find: /^@recur\/core$/, replacement: src("./packages/core/src/index.ts") },
      { find: /^@recur\/ledger$/, replacement: src("./packages/ledger/src/index.ts") },
      { find: /^@recur\/stellar$/, replacement: src("./packages/stellar/src/index.ts") },
      { find: /^@recur\/scheduler$/, replacement: src("./apps/scheduler/src/index.ts") },
    ],
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    environment: "node",
    coverage: {
      reporter: ["text", "lcov"],
      include: ["packages/*/src/**", "apps/*/src/**"],
    },
  },
});
