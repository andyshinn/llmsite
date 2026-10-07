import { describe, expect, it } from "vitest";
import { normalizedPostSchema, type NormalizedPost } from "@radar/core";
import { hn } from "../src/sources/hn.ts";
import { MAX_PAGES, lobsters, newestPageUrl } from "../src/sources/lobsters.ts";
import hnSearch from "./fixtures/hn-search.json";
import lobstersNewest from "./fixtures/lobsters-newest.json";
import { env } from "cloudflare:workers";
import type { Fetcher } from "../src/deps.ts";
import type { SourceContext } from "../src/sources/types.ts";
import { fakeFetch, json } from "./helpers.ts";

const ctx = (fetcher: Fetcher, over: Partial<SourceContext> = {}): SourceContext => ({
  fetch: fetcher, db: env.DB, sleep: async () => {}, ...over,
});

async function collect(iter: AsyncIterable<NormalizedPost[]>): Promise<NormalizedPost[][]> {
  const pages: NormalizedPost[][] = [];
  for await (const page of iter) pages.push(page);
  return pages;
}

describe("hn adapter", () => {
  const window = { since: Date.parse("2026-10-04T00:00:00Z"), until: Date.parse("2026-10-07T00:00:00Z") };

  it("normalizes Algolia hits", async () => {
    const fetcher = fakeFetch((u) => (u.startsWith("https://hn.algolia.com/api/v1/search_by_date?") ? json(hnSearch) : undefined));
    const [page] = await collect(hn.fetchPosts({ ...window, mode: "daily" }, ctx(fetcher)));
    expect(page).toHaveLength(hnSearch.hits.length);
    for (const post of page!) normalizedPostSchema.parse(post);

    const ask = page!.find((p) => p.title.startsWith("Ask HN"))!;
    expect(ask.url).toBe(`https://news.ycombinator.com/item?id=${ask.external_id}`);
    expect(ask.tags).toEqual(["ask_hn"]);
    expect(page!.filter((p) => p.tags.includes("show_hn")).length).toBeGreaterThan(0);

    const url = new URL(fetcher.calls[0]!);
    expect(url.searchParams.get("numericFilters")).toBe(`created_at_i>${window.since / 1000},created_at_i<=${window.until / 1000}`);
  });

  it("pages backwards by timestamp when a page is full", async () => {
    const hit = (id: number, t: number) => ({ objectID: String(id), title: `t${id}`, url: null, created_at_i: t, _tags: ["story"] });
    const full = { hits: Array.from({ length: 1000 }, (_, i) => hit(i, 1_791_200_000 - i)) };
    const last = { hits: [hit(5000, 1_791_100_000)] };
    let call = 0;
    const fetcher = fakeFetch(() => json(++call === 1 ? full : last));
    const pages = await collect(hn.fetchPosts({ ...window, mode: "daily" }, ctx(fetcher)));
    expect(pages.map((p) => p.length)).toEqual([1000, 1]);
    expect(decodeURIComponent(fetcher.calls[1]!)).toContain(`created_at_i<=${1_791_200_000 - 999}`);
  });
});

describe("lobsters adapter", () => {
  it("normalizes stories and stops once it passes the window", async () => {
    const fetcher = fakeFetch((u) => (u === newestPageUrl(1) ? json(lobstersNewest) : undefined));
    const since = Date.parse("2026-10-05T16:00:00Z"); // between stories, so page 1 is the last page needed
    const [page, ...rest] = await collect(lobsters.fetchPosts({ since, until: Date.parse("2026-10-06T00:00:00Z"), mode: "daily" }, ctx(fetcher)));
    expect(rest).toEqual([]);
    expect(fetcher.calls).toHaveLength(1);
    for (const post of page!) {
      normalizedPostSchema.parse(post);
      expect(Date.parse(post.posted_at)).toBeGreaterThan(since);
    }
    const textPost = page!.find((p) => p.external_id === "nvkrb9")!;
    expect(textPost.url).toMatch(/^https:\/\/lobste\.rs\/s\/nvkrb9\//);
    expect(textPost.author).toBe("caius");
  });

  it("fails loudly when /newest is stale instead of returning nothing", async () => {
    const fetcher = fakeFetch(() => json(lobstersNewest));
    const window = { since: Date.parse("2026-12-01T00:00:00Z"), until: Date.parse("2026-12-02T00:00:00Z") };
    await expect(collect(lobsters.fetchPosts({ ...window, mode: "backfill" }, ctx(fetcher)))).rejects.toThrow("looks stale");
  });

  it("fails instead of reporting success when the page cap stops a backfill early", async () => {
    const fetcher = fakeFetch(() => json(lobstersNewest)); // every page is still newer than `since`
    const window = { since: 0, until: Date.parse("2026-10-06T00:00:00Z") };
    await expect(collect(lobsters.fetchPosts({ ...window, mode: "backfill" }, ctx(fetcher)))).rejects.toThrow(`${MAX_PAGES}-page cap`);
    expect(fetcher.calls).toHaveLength(MAX_PAGES);
  });

  it("keeps paging while every story is inside the window", async () => {
    const fetcher = fakeFetch((u) => json(u === newestPageUrl(1) ? lobstersNewest : []));
    const pages = await collect(lobsters.fetchPosts({ since: 0, until: Date.parse("2026-10-07T00:00:00Z"), mode: "backfill" }, ctx(fetcher)));
    expect(pages.flat()).toHaveLength(lobstersNewest.length);
    expect(fetcher.calls).toEqual([newestPageUrl(1), newestPageUrl(2)]);
  });
});
