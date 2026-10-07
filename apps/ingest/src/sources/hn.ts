import { z } from "zod";
import type { NormalizedPost } from "@radar/core";
import { getJson } from "../http.ts";
import type { Adapter } from "./types.ts";

const API = "https://hn.algolia.com/api/v1/search_by_date";
const PAGE_SIZE = 1000; // Algolia's cap per query; we page backwards by timestamp instead.

const hitSchema = z.object({
  objectID: z.string(),
  title: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  points: z.number().nullable().optional(),
  num_comments: z.number().nullable().optional(),
  created_at_i: z.number(),
  _tags: z.array(z.string()).default([]),
});
const responseSchema = z.object({ hits: z.array(hitSchema) });

export function hnItemUrl(id: string): string {
  return `https://news.ycombinator.com/item?id=${id}`;
}

function toPost(hit: z.infer<typeof hitSchema>): NormalizedPost | null {
  if (!hit.title) return null;
  return {
    source: "hn",
    external_id: hit.objectID,
    url: hit.url || hnItemUrl(hit.objectID),
    title: hit.title,
    author: hit.author ?? null,
    posted_at: new Date(hit.created_at_i * 1000).toISOString(),
    score: hit.points ?? 0,
    comments: hit.num_comments ?? 0,
    tags: hit._tags.filter((t) => t === "show_hn" || t === "ask_hn"),
  };
}

export const hn: Adapter = {
  source: "hn",
  windowed: true,
  async *fetchPosts({ since, until }, { fetch: fetcher }) {
    const lower = Math.floor(since / 1000);
    let upper = Math.floor(until / 1000);
    while (upper > lower) {
      const params = new URLSearchParams({
        tags: "story",
        hitsPerPage: String(PAGE_SIZE),
        numericFilters: `created_at_i>${lower},created_at_i<=${upper}`,
        attributesToRetrieve: "title,url,author,points,num_comments,created_at_i,_tags",
      });
      const { hits } = responseSchema.parse(await getJson(fetcher, `${API}?${params}`));
      yield hits.map(toPost).filter((p): p is NormalizedPost => p !== null);
      if (hits.length < PAGE_SIZE) return;
      // Next page: everything at or before the oldest hit (overlap is deduped on insert).
      const oldest = Math.min(...hits.map((h) => h.created_at_i));
      upper = oldest < upper ? oldest : upper - 1;
    }
  },
};
