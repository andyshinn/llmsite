import { type ClassifyJob, type FetchJob, type NormalizedPost, canonicalUrl, getSetting, prefilterScore } from "@radar/core";
import type { Deps } from "./deps.ts";
import { ADAPTERS } from "./sources/index.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Daily runs look back 26h so a late or slow run never leaves a gap; overlap is deduped.
export const DAILY_LOOKBACK = 26 * HOUR;

const iso = (ms: number) => new Date(ms).toISOString();

async function sendAll<T>(queue: Queue, bodies: T[]): Promise<void> {
  for (let i = 0; i < bodies.length; i += 100) {
    await queue.sendBatch(bodies.slice(i, i + 100).map((body) => ({ body })));
  }
}

export async function runFetchJob(job: FetchJob, deps: Deps, now = Date.now()): Promise<void> {
  const adapter = ADAPTERS[job.source];
  if (!adapter) {
    console.warn(JSON.stringify({ event: "fetch_skipped", source: job.source, reason: "no adapter yet" }));
    return;
  }
  const until = job.until ? Date.parse(job.until) : now;
  const since = job.since ? Date.parse(job.since) : until - DAILY_LOOKBACK;

  // Long backfills on date-filterable sources fan out into one job per day.
  if (adapter.windowed && until - since > 2 * DAY) {
    const jobs: FetchJob[] = [];
    for (let start = since; start < until; start += DAY) {
      jobs.push({ ...job, since: iso(start), until: iso(Math.min(start + DAY, until)) });
    }
    await sendAll(deps.fetchQueue, jobs);
    console.log(JSON.stringify({ event: "fetch_fanout", source: job.source, jobs: jobs.length }));
    return;
  }

  const run = await deps.db
    .prepare("INSERT INTO source_runs (source, mode) VALUES (?, ?) RETURNING id")
    .bind(job.source, job.mode)
    .first<{ id: number }>();
  const finish = (fetched: number, error: string | null) =>
    deps.db
      .prepare(
        "UPDATE source_runs SET finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), items_fetched = ?, error = ? WHERE id = ?",
      )
      .bind(fetched, error, run!.id)
      .run();

  let fetched = 0;
  let kept = 0;
  let created = 0;
  try {
    const keywords = await getSetting(deps.db, "prefilter_keywords");
    const today = iso(now).slice(0, 10);
    const ctx = { fetch: deps.fetch, db: deps.db, githubToken: deps.githubToken, sleep: deps.sleep };
    for await (const page of adapter.fetchPosts({ since, until, mode: job.mode }, ctx)) {
      fetched += page.length;
      const passed = page.filter((p) => prefilterScore(p, keywords) > 0);
      kept += passed.length;
      const ids = await storePosts(deps.db, passed, today);
      created += ids.length;
      await sendAll<ClassifyJob>(deps.classifyQueue, ids.map((post_id) => ({ kind: "classify", post_id })));
    }
    await finish(fetched, null);
  } catch (err) {
    await finish(fetched, String(err));
    throw err;
  }
  console.log(
    JSON.stringify({ event: "fetch_done", source: job.source, mode: job.mode, since: iso(since), until: iso(until), fetched, dropped_by_prefilter: fetched - kept, created }),
  );
}

/** Inserts new posts (ignoring ones already stored) and upserts today's engagement snapshot. Returns new post IDs. */
export async function storePosts(db: D1Database, posts: NormalizedPost[], date: string): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < posts.length; i += 25) {
    const chunk = posts.slice(i, i + 25);
    const statements = chunk.flatMap((p) => [
      db
        .prepare(
          `INSERT INTO posts (source, external_id, url, canonical_url, title, author, posted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (source, external_id) DO NOTHING
           RETURNING id`,
        )
        .bind(p.source, p.external_id, p.url, canonicalUrl(p.url), p.title, p.author, p.posted_at),
      db
        .prepare(
          `INSERT INTO post_snapshots (post_id, date, score, comments)
           SELECT id, ?, ?, ? FROM posts WHERE source = ? AND external_id = ?
           ON CONFLICT (post_id, date) DO UPDATE SET score = excluded.score, comments = excluded.comments`,
        )
        .bind(date, p.score, p.comments, p.source, p.external_id),
    ]);
    const results = await db.batch<{ id: number }>(statements);
    for (let j = 0; j < results.length; j += 2) {
      const id = results[j]?.results[0]?.id;
      if (id !== undefined) ids.push(id);
    }
  }
  return ids;
}
