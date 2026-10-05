-- 0001_init: full schema from docs/DESIGN.md "Data model".
-- Timestamps are ISO 8601 UTC text; snapshot dates are YYYY-MM-DD.
-- Booleans are INTEGER 0/1. JSON columns are TEXT checked with json_valid().

CREATE TABLE tools (
  id              INTEGER PRIMARY KEY,
  slug            TEXT    NOT NULL UNIQUE,
  name            TEXT    NOT NULL,
  description     TEXT,
  category        TEXT,
  tags            TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
  homepage_url    TEXT,
  github_repo     TEXT,
  is_open_source  INTEGER CHECK (is_open_source IN (0, 1)),
  status          TEXT    NOT NULL DEFAULT 'queued' CHECK (status IN ('published', 'queued', 'hidden')),
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  trending_score  REAL    NOT NULL DEFAULT 0,
  first_seen_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_post_at    TEXT
);

CREATE INDEX tools_status_trending ON tools (status, trending_score DESC);
CREATE INDEX tools_status_first_seen ON tools (status, first_seen_at DESC);
CREATE INDEX tools_category ON tools (category);
CREATE INDEX tools_active ON tools (is_active);

CREATE TABLE tool_aliases (
  tool_id  INTEGER NOT NULL REFERENCES tools (id),
  kind     TEXT    NOT NULL CHECK (kind IN ('repo', 'domain', 'name')),
  value    TEXT    NOT NULL,
  PRIMARY KEY (kind, value)
);

CREATE INDEX tool_aliases_tool ON tool_aliases (tool_id);

CREATE TABLE tool_merges (
  id             INTEGER PRIMARY KEY,
  from_tool_id   INTEGER NOT NULL REFERENCES tools (id),
  into_tool_id   INTEGER NOT NULL REFERENCES tools (id),
  moved_aliases  TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(moved_aliases)),
  moved_posts    TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(moved_posts)),
  merged_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  undone_at      TEXT
);

CREATE INDEX tool_merges_from ON tool_merges (from_tool_id);
CREATE INDEX tool_merges_into ON tool_merges (into_tool_id);

CREATE TABLE posts (
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
  status          TEXT    NOT NULL DEFAULT 'queued' CHECK (status IN ('published', 'queued', 'rejected', 'dropped')),
  drop_reason     TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (source, external_id)
);

CREATE INDEX posts_canonical_url ON posts (canonical_url);
CREATE INDEX posts_tool_posted ON posts (tool_id, posted_at DESC);
CREATE INDEX posts_status ON posts (status, created_at);

CREATE TABLE post_snapshots (
  post_id   INTEGER NOT NULL REFERENCES posts (id),
  date      TEXT    NOT NULL,
  score     INTEGER NOT NULL DEFAULT 0,
  comments  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, date)
);

CREATE TABLE repo_snapshots (
  tool_id   INTEGER NOT NULL REFERENCES tools (id),
  date      TEXT    NOT NULL,
  stars     INTEGER NOT NULL DEFAULT 0,
  forks     INTEGER NOT NULL DEFAULT 0,
  language  TEXT,
  license   TEXT,
  PRIMARY KEY (tool_id, date)
);

CREATE TABLE review_decisions (
  id                INTEGER PRIMARY KEY,
  post_id           INTEGER NOT NULL REFERENCES posts (id),
  decision          TEXT    NOT NULL,
  corrected_fields  TEXT    CHECK (corrected_fields IS NULL OR json_valid(corrected_fields)),
  use_in_prompt     INTEGER NOT NULL DEFAULT 0 CHECK (use_in_prompt IN (0, 1)),
  decided_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX review_decisions_post ON review_decisions (post_id);
CREATE INDEX review_decisions_fewshot ON review_decisions (use_in_prompt, decided_at DESC);

CREATE TABLE reports (
  id           INTEGER PRIMARY KEY,
  tool_id      INTEGER NOT NULL REFERENCES tools (id),
  reason       TEXT    NOT NULL,
  note         TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at  TEXT
);

CREATE INDEX reports_open ON reports (resolved_at, created_at);

CREATE TABLE source_runs (
  id             INTEGER PRIMARY KEY,
  source         TEXT    NOT NULL,
  started_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at    TEXT,
  items_fetched  INTEGER,
  error          TEXT
);

CREATE INDEX source_runs_source_started ON source_runs (source, started_at DESC);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL CHECK (json_valid(value))
);

-- Full-text search over tool name, description and tags, kept in sync with
-- triggers. External-content table: the text lives in `tools` only.
CREATE VIRTUAL TABLE tools_fts USING fts5 (
  name,
  description,
  tags,
  content = 'tools',
  content_rowid = 'id'
);

CREATE TRIGGER tools_fts_ai AFTER INSERT ON tools BEGIN
  INSERT INTO tools_fts (rowid, name, description, tags)
  VALUES (new.id, new.name, new.description, new.tags);
END;

CREATE TRIGGER tools_fts_ad AFTER DELETE ON tools BEGIN
  INSERT INTO tools_fts (tools_fts, rowid, name, description, tags)
  VALUES ('delete', old.id, old.name, old.description, old.tags);
END;

CREATE TRIGGER tools_fts_au AFTER UPDATE OF name, description, tags ON tools BEGIN
  INSERT INTO tools_fts (tools_fts, rowid, name, description, tags)
  VALUES ('delete', old.id, old.name, old.description, old.tags);
  INSERT INTO tools_fts (rowid, name, description, tags)
  VALUES (new.id, new.name, new.description, new.tags);
END;

-- Default settings. review_threshold = 1 sends everything to review until launch.
INSERT INTO settings (key, value) VALUES
  ('review_threshold', '1'),
  ('trending_weights', '{"w_s":3.0,"w_e":1.0,"w_g":1.5,"g":1.5}'),
  ('categories', '["agent","ide","cli","mcp-server","other"]'),
  ('prefilter_keywords', '["llm","agent","agentic","mcp","copilot","claude","cursor","codegen","codex","gemini","gpt","ai"]'),
  ('model_id', '"@cf/meta/llama-3.3-70b-instruct-fp8-fast"'),
  ('max_fewshot', '20');
