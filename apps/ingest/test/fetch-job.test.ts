import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { runFetchJob } from "../src/fetch-job.ts";
import hnSearch from "./fixtures/hn-search.json";
import { fakeFetch, json, makeDeps, resetDb } from "./helpers.ts";

const NOW = Date.parse("2026-10-06T06:00:00Z");
const hnFetch = () => fakeFetch((u) => (u.startsWith("https://hn.algolia.com/") ? json(hnSearch) : undefined));

beforeEach(resetDb);

describe("runFetchJob", () => {
  it("stores only posts that pass the pre-filter and enqueues them for classification", async () => {
    const deps = makeDeps({ fetch: hnFetch() });
    await runFetchJob({ kind: "fetch", source: "hn", mode: "daily" }, deps, NOW);

    const { results: posts } = await env.DB.prepare("SELECT id, title, canonical_url, status FROM posts ORDER BY id").all<{
      id: number; title: string; canonical_url: string; status: string;
    }>();
    const titles = posts.map((p) => p.title);
    expect(titles.some((t) => t.startsWith("Show HN"))).toBe(true);
    expect(titles).toContain("LLMs may have immensely helped my RSI");
    expect(titles).toContain("Iseberg – The PowerShell ISE Reimagined with Avalonia and PowerShell 7"); // GitHub repo link
    expect(titles.some((t) => t.startsWith("Drones"))).toBe(false);
    expect(posts.every((p) => p.status === "pending")).toBe(true);
    expect(posts.find((p) => p.title.startsWith("Iseberg"))!.canonical_url).toBe("https://github.com/adamdriscoll/iseberg");

    expect(deps.classifySent).toEqual(posts.map((p) => ({ kind: "classify", post_id: p.id })));

    const snapshots = await env.DB.prepare("SELECT count(*) AS n FROM post_snapshots WHERE date = '2026-10-06'").first<{ n: number }>();
    expect(snapshots!.n).toBe(posts.length);

    const run = await env.DB.prepare("SELECT source, mode, items_fetched, error, finished_at FROM source_runs").first<Record<string, unknown>>();
    expect(run).toMatchObject({ source: "hn", mode: "daily", items_fetched: hnSearch.hits.length, error: null });
    expect(run!.finished_at).not.toBeNull();
  });

  it("does not store or enqueue a post twice", async () => {
    await runFetchJob({ kind: "fetch", source: "hn", mode: "daily" }, makeDeps({ fetch: hnFetch() }), NOW);
    const second = makeDeps({ fetch: hnFetch() });
    await runFetchJob({ kind: "fetch", source: "hn", mode: "daily" }, second, NOW + 3_600_000);
    expect(second.classifySent).toEqual([]);
  });

  it("records the error and rethrows when the source fails", async () => {
    const deps = makeDeps({ fetch: fakeFetch(() => new Response("down", { status: 503 })) });
    await expect(runFetchJob({ kind: "fetch", source: "hn", mode: "manual" }, deps, NOW)).rejects.toThrow("503");
    const run = await env.DB.prepare("SELECT error FROM source_runs").first<{ error: string }>();
    expect(run!.error).toContain("503");
  });

  it("fans a long HN backfill out into one job per day", async () => {
    const deps = makeDeps();
    await runFetchJob(
      { kind: "fetch", source: "hn", mode: "backfill", since: "2026-09-29T00:00:00.000Z", until: "2026-10-06T00:00:00.000Z" },
      deps,
      NOW,
    );
    expect(deps.fetchSent).toHaveLength(7);
    expect(deps.fetchSent[0]).toEqual({
      kind: "fetch", source: "hn", mode: "backfill", since: "2026-09-29T00:00:00.000Z", until: "2026-09-30T00:00:00.000Z",
    });
    const runs = await env.DB.prepare("SELECT count(*) AS n FROM source_runs").first<{ n: number }>();
    expect(runs!.n).toBe(0);
  });

  it("skips sources without an adapter", async () => {
    const deps = makeDeps();
    await runFetchJob({ kind: "fetch", source: "producthunt", mode: "manual" }, deps, NOW);
    const runs = await env.DB.prepare("SELECT count(*) AS n FROM source_runs").first<{ n: number }>();
    expect(runs!.n).toBe(0);
  });
});
