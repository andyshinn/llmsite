import type { FetchJob, Source } from "./jobs.ts";

/** Sources that have an adapter in the ingest Worker (a test there keeps this in sync). */
export const ENABLED_SOURCES = ["hn", "lobsters", "github"] as const satisfies readonly Source[];

/** Sources whose backfill fans out into one fetch job per day (the rest run as one job). */
export const WINDOWED_SOURCES = ["hn", "github"] as const satisfies readonly Source[];

const DAY = 86_400_000;

/** How many fetch runs a backfill of `days` days produces (the ingest Worker fans out windowed sources over 2 days). */
export function backfillRunCount(sources: readonly Source[], days: number): number {
  return sources.reduce((n, s) => n + ((WINDOWED_SOURCES as readonly string[]).includes(s) && days > 2 ? days : 1), 0);
}

/** Fetch jobs for a "run now" (mode manual) or a backfill of `days` days, one per source. */
export function fetchJobs(sources: readonly Source[], mode: "manual" | "backfill", options: { days?: number; now?: number } = {}): FetchJob[] {
  const now = options.now ?? Date.now();
  return sources.map((source) =>
    mode === "backfill"
      ? { kind: "fetch", source, mode, since: new Date(now - (options.days ?? 90) * DAY).toISOString(), until: new Date(now).toISOString() }
      : { kind: "fetch", source, mode },
  );
}

const ORPHAN_TOOL = `t.status = 'queued'
    AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.tool_id = t.id)
    AND NOT EXISTS (SELECT 1 FROM tool_merges m WHERE m.from_tool_id = t.id OR m.into_tool_id = t.id)
    AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.tool_id = t.id)
    AND NOT EXISTS (SELECT 1 FROM repo_snapshots s WHERE s.tool_id = t.id)`;

/**
 * Re-classification after a classifier change: queued posts nobody has reviewed go
 * back to `pending`, and the tools only they had created are removed. Posts with any
 * review decision, and tools that are published or used elsewhere, are untouched.
 * Used by the admin status panel and by ops.yml (which writes these to a .sql file).
 */
export const RESET_UNREVIEWED_QUEUED_SQL = [
  `UPDATE posts
  SET status = 'pending', classification = NULL, confidence = NULL, raw_output = NULL,
      tool_id = NULL, post_type = NULL, version = NULL, classified_at = NULL
  WHERE status = 'queued' AND id NOT IN (SELECT post_id FROM review_decisions)`,
  `DELETE FROM tool_aliases WHERE tool_id IN (SELECT t.id FROM tools t WHERE ${ORPHAN_TOOL})`,
  `DELETE FROM tools WHERE id IN (SELECT t.id FROM tools t WHERE ${ORPHAN_TOOL})`,
];

/**
 * Dropped posts whose classification came from a model other than the current
 * `model_id` (or from before the model was recorded). After a model change, the
 * old model's drops may hide real tools; posts judged by the current model are kept.
 */
const OLD_MODEL_DROP = `status = 'dropped'
    AND json_extract(classification, '$.model') IS NOT (SELECT json_extract(value, '$') FROM settings WHERE key = 'model_id')`;

/** Optional extra reset step: old-model drops go back to `pending` too. Used by the panel and ops.yml. */
export const RESET_OLD_MODEL_DROPS_SQL = `UPDATE posts
  SET status = 'pending', classification = NULL, confidence = NULL, raw_output = NULL,
      post_type = NULL, version = NULL, drop_reason = NULL, classified_at = NULL
  WHERE ${OLD_MODEL_DROP}`;

/** How many posts and tools a reset would touch (for the confirmation screen). */
export const RESET_PREVIEW_SQL = `SELECT
  (SELECT count(*) FROM posts WHERE status = 'queued' AND id NOT IN (SELECT post_id FROM review_decisions)) AS posts,
  (SELECT count(*) FROM posts WHERE status = 'queued' AND id IN (SELECT post_id FROM review_decisions)) AS kept,
  (SELECT count(*) FROM posts WHERE ${OLD_MODEL_DROP}) AS old_drops`;

/**
 * Runs the reset as one transaction and returns the IDs of every post now waiting for
 * classification. With `includeOldDrops`, posts dropped by an older model are reset too.
 */
export async function resetUnreviewedQueued(db: D1Database, options: { includeOldDrops?: boolean } = {}): Promise<number[]> {
  const statements = [...RESET_UNREVIEWED_QUEUED_SQL, ...(options.includeOldDrops ? [RESET_OLD_MODEL_DROPS_SQL] : [])];
  await db.batch(statements.map((sql) => db.prepare(sql)));
  const { results } = await db.prepare("SELECT id FROM posts WHERE status = 'pending' ORDER BY id").all<{ id: number }>();
  return results.map((r) => r.id);
}
