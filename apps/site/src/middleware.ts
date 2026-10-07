import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { guardAdmin, isAdminPath } from "./lib/access.ts";

export const onRequest = defineMiddleware(async (context, next) => {
  if (!isAdminPath(context.url.pathname)) return next();

  const result = await guardAdmin(context.request, env as unknown as Record<string, unknown>);
  if ("response" in result) return result.response;

  context.locals.adminEmail = result.email;
  const response = await next();
  response.headers.set("cache-control", "no-store");
  response.headers.set("x-robots-tag", "noindex, nofollow");
  return response;
});
