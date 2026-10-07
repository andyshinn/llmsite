-- 0004: settings for the GitHub adapter.
-- github_min_stars: ~2,000 repos with these topics are created per day, mostly
-- empty or abandoned; at >= 10 stars it is ~22/day (measured over a week, Oct 2026).
INSERT INTO settings (key, value) VALUES
  ('github_topics', '["mcp","mcp-server","model-context-protocol","ai-agents","ai-agent","coding-agent","ai-coding","agentic-coding","claude-code","cursor","copilot","vibe-coding","llm-tools"]'),
  ('github_min_stars', '10');
