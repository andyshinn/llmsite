-- 0007: progress on the admin status panel.
-- posts.classified_at: when a post left `pending` (set by trigger, so every
-- classifier path is covered). The panel derives the classification rate and
-- an ETA from it. Rows classified before this migration stay NULL.
ALTER TABLE posts ADD COLUMN classified_at TEXT;
CREATE INDEX posts_classified_at ON posts (classified_at);

CREATE TRIGGER posts_classified AFTER UPDATE OF status ON posts
WHEN OLD.status = 'pending' AND NEW.status != 'pending'
BEGIN
  UPDATE posts SET classified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

-- operations: backfills and re-classifies started from the admin panel, so it
-- can show their progress. total is fetch jobs (backfill) or posts (reclassify);
-- last_post_id is the highest post a re-classify reset.
CREATE TABLE operations (
  id            INTEGER PRIMARY KEY,
  kind          TEXT    NOT NULL CHECK (kind IN ('backfill', 'reclassify')),
  source        TEXT,
  days          INTEGER,
  total         INTEGER NOT NULL,
  last_post_id  INTEGER,
  started_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at   TEXT
);
