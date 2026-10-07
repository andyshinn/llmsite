import cloudflare from "@astrojs/cloudflare";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  // No sessions and no Images binding: both would make wrangler auto-provision
  // extra resources (KV, Images) outside bootstrap.yml.
  session: false,
  adapter: cloudflare({ imageService: "compile" }),
  vite: { plugins: [tailwindcss()] },
});
