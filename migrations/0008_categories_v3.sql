-- 0008: more specific categories, from the first GLM re-classify (Oct 2026):
-- about half of the queued tools landed in "other". The new ones split out
-- coding-agent add-ons, tools that manage agents, agent security, code review
-- and testing, and memory/context. No renames: existing categories stay valid.
-- Order matters only for display; the classifier prompt describes each one.
UPDATE settings
SET value = '["agent","agent-addon","agent-tools","agent-security","review-testing","memory-context","ide","cli","mcp-dev","mcp-general","other"]'
WHERE key = 'categories';
