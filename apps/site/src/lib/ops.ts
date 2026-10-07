import {
  type ClassifyJob,
  ENABLED_SOURCES,
  type FetchJob,
  RESET_PREVIEW_SQL,
  type Source,
  fetchJobs,
  resetUnreviewedQueued,
} from "@radar/core";

export interface SourceRun {
  started_at: string;
  finished_at: string | null;
  items_fetched: number | null;
  error: string | null;
}

export interface SourceStatus {
  source: Source;
  last: SourceRun | null;
  /** Average items per finished, error-free run over the 7 days before the last run. */
  weekAverage: number | null;
  /** The last run fetched less than half the weekly average. */
  dropWarning: boolean;
}

async function sendAll<T>(queue: Queue, bodies: T[]): Promise<void> {
  for (let i = 0; i < bodies.length; i += 100) {
    await queue.sendBatch(bodies.slice(i, i + 100).map((body) => ({ body })));
  }
}

export async function sourceStatuses(db: D1Database): Promise<SourceStatus[]> {
  return Promise.all(
    ENABLED_SOURCES.map(async (source) => {
      const last = await db
        .prepare("SELECT started_at, finished_at, items_fetched, error FROM source_runs WHERE source = ? ORDER BY started_at DESC LIMIT 1")
        .bind(source)
        .first<SourceRun>();
      const avg = last
        ? await db
            .prepare(
              `SELECT avg(items_fetched) AS a FROM source_runs
               WHERE source = ? AND error IS NULL AND finished_at IS NOT NULL
                 AND started_at < ? AND started_at >= strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-7 days')`,
            )
            .bind(source, last.started_at, last.started_at)
            .first<{ a: number | null }>()
        : null;
      const weekAverage = avg?.a ?? null;
      const dropWarning = Boolean(last && !last.error && weekAverage && (last.items_fetched ?? 0) < weekAverage / 2);
      return { source, last, weekAverage, dropWarning };
    }),
  );
}

export async function postCounts(db: D1Database): Promise<Record<string, number>> {
  const { results } = await db.prepare("SELECT status, count(*) AS n FROM posts GROUP BY status").all<{ status: string; n: number }>();
  return Object.fromEntries(results.map((r) => [r.status, r.n]));
}

function sourcesFor(choice: string): Source[] {
  if (choice === "all") return [...ENABLED_SOURCES];
  if ((ENABLED_SOURCES as readonly string[]).includes(choice)) return [choice as Source];
  throw new Error(`Unknown source: ${choice}`);
}

/** "Run now": one manual fetch job per chosen source. */
export async function runNow(fetchQueue: Queue, choice: string): Promise<FetchJob[]> {
  const jobs = fetchJobs(sourcesFor(choice), "manual");
  await sendAll(fetchQueue, jobs);
  return jobs;
}

export const MAX_BACKFILL_DAYS = 180;

export async function startBackfill(fetchQueue: Queue, choice: string, days: number, now = Date.now()): Promise<FetchJob[]> {
  if (!Number.isInteger(days) || days < 1 || days > MAX_BACKFILL_DAYS) throw new Error(`Days must be a whole number from 1 to ${MAX_BACKFILL_DAYS}.`);
  const jobs = fetchJobs(sourcesFor(choice), "backfill", { days, now });
  await sendAll(fetchQueue, jobs);
  return jobs;
}

export async function reclassifyPreview(db: D1Database): Promise<{ posts: number; kept: number }> {
  return (await db.prepare(RESET_PREVIEW_SQL).first<{ posts: number; kept: number }>()) ?? { posts: 0, kept: 0 };
}

/** Resets unreviewed queued posts and enqueues every pending post for classification. */
export async function reclassifyQueued(db: D1Database, classifyQueue: Queue): Promise<number> {
  const ids = await resetUnreviewedQueued(db);
  // Forced: re-run the model even when a same-URL post already has a result.
  await sendAll<ClassifyJob>(classifyQueue, ids.map((post_id) => ({ kind: "classify", post_id, force: true })));
  return ids.length;
}

// Rough planning numbers shown before a backfill, from October 2026 measurements:
// posts passing the pre-filter per day by source, and GLM 5.3 Flash cost per post.
const POSTS_PER_DAY: Record<string, number> = { hn: 284, lobsters: 7, github: 25 };
const COST_PER_POST_USD = 0.0004;
const CLASSIFY_PER_MINUTE = 18;

export function backfillEstimate(choice: string, days: number): { posts: number; costUsd: number; hours: number } {
  const posts = sourcesFor(choice).reduce((n, s) => n + (POSTS_PER_DAY[s] ?? 0) * days, 0);
  return { posts, costUsd: posts * COST_PER_POST_USD, hours: posts / CLASSIFY_PER_MINUTE / 60 };
}
