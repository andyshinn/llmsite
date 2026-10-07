import { resolve } from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Unit tests for src/lib against a migrated local D1 and R2. Bindings are declared
// here rather than read from wrangler.jsonc, whose `main` is the Astro build output.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(resolve(import.meta.dirname, "../../migrations"));
  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          compatibilityDate: "2026-08-15",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["DB"],
          r2Buckets: ["ARTICLES"],
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: { include: ["test/**/*.test.ts"], setupFiles: ["./test/apply-migrations.ts"] },
  };
});
