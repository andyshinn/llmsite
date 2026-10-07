-- 0005: classifier model and categories, from the accuracy pass in
-- evals/classifier (150 hand-labeled posts, Oct 2026).
--
-- Model: GLM 5.3 Flash with low reasoning scored 85% precision vs 39% for
-- Llama 3.3 70B on the old prompt, at well under half the cost.
UPDATE settings SET value = '"@cf/zai-org/glm-5.3-flash"' WHERE key = 'model_id';
INSERT INTO settings (key, value) VALUES ('model_reasoning_effort', '"low"')
  ON CONFLICT (key) DO UPDATE SET value = excluded.value;

-- Every MCP server is in scope, split by whether it helps with software development.
UPDATE settings
SET value = '["agent","ide","cli","mcp-dev","mcp-general","other"]'
WHERE key = 'categories';

UPDATE tools SET category = 'mcp-dev' WHERE category = 'mcp-server';
UPDATE posts
SET classification = json_set(classification, '$.category', 'mcp-dev')
WHERE classification IS NOT NULL AND json_extract(classification, '$.category') = 'mcp-server';
-- Reviewer corrections are overlaid on classifications for few-shot examples.
UPDATE review_decisions
SET corrected_fields = json_set(corrected_fields, '$.category', 'mcp-dev')
WHERE corrected_fields IS NOT NULL AND json_extract(corrected_fields, '$.category') = 'mcp-server';
