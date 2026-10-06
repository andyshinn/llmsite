-- 0002: posts get a 'pending' status (stored, not yet classified) as the new
-- default, and a raw_output column for model output that failed validation.
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt.

PRAGMA defer_foreign_keys = true;

CREATE TABLE posts_new (
  id              INTEGER PRIMARY KEY,
  source          TEXT    NOT NULL,
  external_id     TEXT    NOT NULL,
  url             TEXT    NOT NULL,
  canonical_url   TEXT    NOT NULL,
  title           TEXT    NOT NULL,
  author          TEXT,
  posted_at       TEXT    NOT NULL,
  tool_id         INTEGER REFERENCES tools (id),
  post_type       TEXT,
  version         TEXT,
  classification  TEXT    CHECK (classification IS NULL OR json_valid(classification)),
  confidence      REAL,
  status          TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'queued', 'rejected', 'dropped')),
  drop_reason     TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  raw_output      TEXT,
  UNIQUE (source, external_id)
);

INSERT INTO posts_new (
  id, source, external_id, url, canonical_url, title, author, posted_at, tool_id, post_type,
  version, classification, confidence, status, drop_reason, created_at
)
SELECT
  id, source, external_id, url, canonical_url, title, author, posted_at, tool_id, post_type,
  version, classification, confidence, status, drop_reason, created_at
FROM posts;

DROP TABLE posts;
ALTER TABLE posts_new RENAME TO posts;

CREATE INDEX posts_canonical_url ON posts (canonical_url);
CREATE INDEX posts_tool_posted ON posts (tool_id, posted_at DESC);
CREATE INDEX posts_status ON posts (status, created_at);

PRAGMA defer_foreign_keys = false;
