import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getSetting } from "@slop-bucket/core";

// Deploy smoke check: proves the Worker is up, the D1 binding works and
// migrations have run. Does not expose setting values.
export const GET: APIRoute = async () => {
  try {
    await getSetting(env.DB, "review_threshold");
    return Response.json({ ok: true, db: true });
  } catch (err) {
    console.error(JSON.stringify({ event: "health_failed", error: String(err) }));
    return Response.json({ ok: false, db: false }, { status: 503 });
  }
};
