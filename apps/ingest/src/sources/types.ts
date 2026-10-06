import type { NormalizedPost, Source } from "@radar/core";
import type { Fetcher } from "../deps.ts";

export interface Window {
  since: number; // epoch ms, exclusive
  until: number; // epoch ms, inclusive
}

export interface Adapter {
  source: Source;
  /** True if the source API filters by date, so backfills can be split into one job per day. */
  windowed: boolean;
  /** Yields pages of posts created inside the window. */
  fetchPosts(window: Window, fetcher: Fetcher): AsyncIterable<NormalizedPost[]>;
}
