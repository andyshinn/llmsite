import type { FetchJob, NormalizedPost, Source } from "@slop-bucket/core";
import type { Fetcher } from "../deps.ts";

export interface Window {
  since: number; // epoch ms, exclusive
  until: number; // epoch ms, inclusive
  mode: FetchJob["mode"];
}

/** What an adapter may use besides the window: HTTP, settings, credentials, pacing. */
export interface SourceContext {
  fetch: Fetcher;
  db: D1Database;
  githubToken?: string;
  sleep: (ms: number) => Promise<void>;
}

export interface Adapter {
  source: Source;
  /** True if the source API filters by date, so backfills can be split into one job per day. */
  windowed: boolean;
  /** Yields pages of posts for the window. */
  fetchPosts(window: Window, ctx: SourceContext): AsyncIterable<NormalizedPost[]>;
}
