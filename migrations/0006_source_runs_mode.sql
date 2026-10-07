-- 0006: record each run's mode (daily, manual, backfill) so the status panel's
-- 7-day average compares like with like. Backfill runs (lobste.rs runs a whole
-- 90-day backfill as one run) would otherwise make normal runs look like drops.
-- Existing rows predate backfills and are daily/manual runs.
ALTER TABLE source_runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'daily';
