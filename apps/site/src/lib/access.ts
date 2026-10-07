import { type JWTVerifyGetKey, createRemoteJWKSet, jwtVerify } from "jose";

export interface AccessConfig {
  teamDomain: string; // e.g. "andyshinn.cloudflareaccess.com"
  aud: string; // the Access application's audience tag
}

/**
 * Read from `vars` in apps/site/wrangler.jsonc. Missing config returns null,
 * and the admin then stays locked rather than open.
 */
export function accessConfig(env: Record<string, unknown>): AccessConfig | null {
  const team = typeof env.ACCESS_TEAM_DOMAIN === "string" ? env.ACCESS_TEAM_DOMAIN.trim() : "";
  const aud = typeof env.ACCESS_AUD === "string" ? env.ACCESS_AUD.trim() : "";
  if (!team || !aud) return null;
  return { teamDomain: team.replace(/^https?:\/\//, "").replace(/\/+$/, ""), aud };
}

const remoteKeys = new Map<string, JWTVerifyGetKey>();

function keysFor(teamDomain: string): JWTVerifyGetKey {
  let keys = remoteKeys.get(teamDomain);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    remoteKeys.set(teamDomain, keys);
  }
  return keys;
}

/**
 * Verifies the JWT Cloudflare Access adds to every request it lets through.
 * This is not login code: Access does the sign-in. Checking its signature here
 * means /admin stays closed even if the Access application is misconfigured.
 * (Workers with static assets do not receive ctx.access, so the header is used.)
 */
export async function verifyAccess(
  request: Request,
  config: AccessConfig,
  keys: JWTVerifyGetKey = keysFor(config.teamDomain),
): Promise<{ email: string } | null> {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, keys, { issuer: `https://${config.teamDomain}`, audience: config.aud });
    return { email: typeof payload.email === "string" ? payload.email : "" };
  } catch {
    return null;
  }
}

/** True for /admin and anything under it, however the path is encoded or cased. */
export function isAdminPath(pathname: string): boolean {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // Malformed encoding: check the raw path.
  }
  path = path.toLowerCase();
  return path === "/admin" || path.startsWith("/admin/");
}

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/**
 * Gate for /admin. Returns the signed-in email, or the response to send instead.
 * Fails closed: no Access config -> 503, no valid Access token -> 403.
 */
export async function guardAdmin(
  request: Request,
  env: Record<string, unknown>,
  keys?: JWTVerifyGetKey,
): Promise<{ email: string } | { response: Response }> {
  const config = accessConfig(env);
  if (!config) return { response: text("Admin is locked: Cloudflare Access is not configured yet.", 503) };

  const user = await verifyAccess(request, config, keys ?? keysFor(config.teamDomain));
  if (!user) return { response: text("Forbidden", 403) };

  // Form posts must come from this site.
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (request.headers.get("origin") !== new URL(request.url).origin) return { response: text("Forbidden: cross-site request", 403) };
  }
  return user;
}
