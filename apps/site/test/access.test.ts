import { type JWK, SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { accessConfig, guardAdmin, isAdminPath } from "../src/lib/access.ts";

const TEAM = "radar-test.cloudflareaccess.com";
const AUD = "aud-tag-123";
const env = { ACCESS_TEAM_DOMAIN: `https://${TEAM}/`, ACCESS_AUD: AUD };

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let keys: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair("RS256")).privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  keys = createLocalJWKSet({ keys: [jwk] });
});

const token = (over: { iss?: string; aud?: string; exp?: string; key?: CryptoKey } = {}) =>
  new SignJWT({ email: "andy@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(over.iss ?? `https://${TEAM}`)
    .setAudience(over.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(over.exp ?? "5m")
    .sign(over.key ?? privateKey);

const request = (jwt?: string, init: RequestInit = {}) =>
  new Request("https://radar.example/admin/queue", {
    ...init,
    headers: { ...(jwt ? { "cf-access-jwt-assertion": jwt } : {}), ...(init.headers as Record<string, string>) },
  });

describe("isAdminPath", () => {
  it.each(["/admin", "/admin/", "/admin/queue/1", "/ADMIN/queue", "/%61dmin/queue", "/admin%2Fqueue"])("%s is admin", (p) => {
    expect(isAdminPath(p)).toBe(true);
  });
  it.each(["/", "/administrator", "/tools/admin", "/adminx"])("%s is public", (p) => {
    expect(isAdminPath(p)).toBe(false);
  });
});

describe("accessConfig", () => {
  it("normalizes the team domain", () => {
    expect(accessConfig(env)).toEqual({ teamDomain: TEAM, aud: AUD });
  });
  it("is null when either value is missing", () => {
    expect(accessConfig({ ACCESS_AUD: AUD })).toBeNull();
    expect(accessConfig({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: " " })).toBeNull();
  });
});

describe("guardAdmin", () => {
  it("fails closed with 503 when Access is not configured", async () => {
    const result = await guardAdmin(request(await token()), {}, keys);
    expect("response" in result && result.response.status).toBe(503);
  });

  it("lets a valid Access token through", async () => {
    expect(await guardAdmin(request(await token()), env, keys)).toEqual({ email: "andy@example.com" });
  });

  it.each([
    ["no token", async () => undefined],
    ["wrong audience", () => token({ aud: "another-app" })],
    ["wrong issuer", () => token({ iss: "https://evil.cloudflareaccess.com" })],
    ["expired", () => token({ exp: "-1m" })],
    ["signed by another key", async () => token({ key: otherKey })],
    ["garbage", async () => "not.a.jwt"],
  ])("rejects %s with 403", async (_, make) => {
    const result = await guardAdmin(request(await make()), env, keys);
    expect("response" in result && result.response.status).toBe(403);
  });

  it("rejects a cross-site form post even with a valid token", async () => {
    const post = (origin: string) => request(undefined, { method: "POST", headers: { origin } });
    const jwt = await token();
    const cross = await guardAdmin(
      new Request(post("https://evil.example"), { headers: { "cf-access-jwt-assertion": jwt, origin: "https://evil.example" } }),
      env,
      keys,
    );
    expect("response" in cross && cross.response.status).toBe(403);
    const same = await guardAdmin(
      new Request("https://radar.example/admin/queue/1", { method: "POST", headers: { "cf-access-jwt-assertion": jwt, origin: "https://radar.example" } }),
      env,
      keys,
    );
    expect(same).toEqual({ email: "andy@example.com" });
  });
});
