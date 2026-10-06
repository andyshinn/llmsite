// Everything the jobs touch, passed in so tests can swap in fakes
// (no live network or Workers AI in tests).

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
export type RunModel = (model: string, input: Record<string, unknown>) => Promise<unknown>;

export interface Deps {
  db: D1Database;
  articles: R2Bucket;
  fetchQueue: Queue;
  classifyQueue: Queue;
  ai: RunModel;
  fetch: Fetcher;
  githubToken?: string;
}

export function depsFromEnv(env: Env): Deps {
  return {
    db: env.DB,
    articles: env.ARTICLES,
    fetchQueue: env.FETCH_QUEUE,
    classifyQueue: env.CLASSIFY_QUEUE,
    // Model IDs come from settings, so they are not one of the typed literals.
    ai: (model, input) =>
      env.AI.run(model as Parameters<Ai["run"]>[0], input as never, { gateway: { id: env.AI_GATEWAY_ID, skipCache: true } }),
    fetch: (input, init) => fetch(input, init),
    // Optional Worker secret; README fetches fall back to raw.githubusercontent.com without it.
    githubToken: (env as { GH_API_TOKEN?: string }).GH_API_TOKEN,
  };
}
