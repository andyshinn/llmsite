import type { Fetcher } from "./deps.ts";

export const USER_AGENT = "ai-coding-tools-radar/0.1 (+https://radar-site.andyshinn.workers.dev)";

export async function getJson(fetcher: Fetcher, url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetcher(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json", ...headers },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}
