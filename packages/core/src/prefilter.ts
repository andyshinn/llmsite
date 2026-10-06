import type { NormalizedPost } from "./posts.ts";
import { githubRepoFromUrl, parseUrl } from "./urls.ts";

const AI_SOURCE_TAGS = new Set(["ai", "vibecoding"]);

function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Stage 1 of classification (no AI). Points for keyword hits in the title, URL
 * host and path, plus one each for a GitHub repo link, Show HN and an AI tag on
 * lobste.rs. A score of zero means the post is dropped before classification.
 */
export function prefilterScore(post: NormalizedPost, keywords: string[]): number {
  const url = parseUrl(post.url);
  const text = [post.title, url?.hostname ?? "", url?.pathname ?? ""].join(" ");
  const words = new Set(tokens(text));
  const joined = ` ${tokens(text).join(" ")} `;

  let score = 0;
  for (const raw of keywords) {
    const kw = tokens(raw).join(" ");
    if (!kw) continue;
    const hit = kw.includes(" ") ? joined.includes(` ${kw} `) : words.has(kw) || words.has(`${kw}s`);
    if (hit) score += 1;
  }
  if (githubRepoFromUrl(post.url)) score += 1;
  if (post.tags.includes("show_hn")) score += 1;
  if (post.source === "lobsters" && post.tags.some((t) => AI_SOURCE_TAGS.has(t))) score += 1;
  return score;
}
