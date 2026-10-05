import { resolve } from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(resolve(import.meta.dirname, "../../migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        // Workers AI only exists remotely; tests must never call it.
        remoteBindings: false,
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      }),
    ],
    test: { setupFiles: ["./test/apply-migrations.ts"] },
  };
});
