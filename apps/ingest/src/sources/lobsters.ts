import { z } from "zod";
import type { NormalizedPost } from "@radar/core";
import { getJson } from "../http.ts";
import type { Adapter } from "./types.ts";

const MAX_PAGES = 200; // 25 stories per page; about 90 days of lobste.rs.

const storySchema = z.object({
  short_id: z.string(),
  created_at: z.string(),
  title: z.string(),
  url: z.string().nullable().optional(),
  score: z.number(),
  comment_count: z.number(),
  submitter_user: z.union([z.string(), z.object({ username: z.string() })]).nullable().optional(),
  tags: z.array(z.string()).default([]),
  comments_url: z.string(),
});

function toPost(story: z.infer<typeof storySchema>): NormalizedPost {
  const user = story.submitter_user;
  return {
    source: "lobsters",
    external_id: story.short_id,
    url: story.url || story.comments_url,
    title: story.title,
    author: typeof user === "string" ? user : (user?.username ?? null),
    posted_at: new Date(story.created_at).toISOString(),
    score: story.score,
    comments: story.comment_count,
    tags: story.tags,
  };
}

export const newestPageUrl = (page: number) => `https://lobste.rs/newest/page/${page}.json`;

// A healthy /newest always has a story from the last few days. (In Oct 2026
// /newest.json?page=N served a months-old cached page; this turns that into an error.)
const STALE_AFTER = 3 * 86_400_000;

// lobste.rs has no date filter, so this pages through /newest until it passes `since`.
export const lobsters: Adapter = {
  source: "lobsters",
  windowed: false,
  async *fetchPosts({ since, until }, fetcher) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const stories = z.array(storySchema).parse(await getJson(fetcher, newestPageUrl(page)));
      if (stories.length === 0) return;
      if (page === 1 && Date.parse(stories[0]!.created_at) < until - STALE_AFTER) {
        throw new Error(`lobste.rs /newest looks stale: newest story is from ${stories[0]!.created_at}`);
      }
      const inWindow = stories.filter((s) => {
        const t = Date.parse(s.created_at);
        return t > since && t <= until;
      });
      yield inWindow.map(toPost);
      if (stories.some((s) => Date.parse(s.created_at) <= since)) return;
    }
  },
};
